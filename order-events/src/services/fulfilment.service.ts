import type { PlatformMessage } from './envelope.service.js';
import type { OrderSnapshot, TransitionResult } from './order.service.js';

/**
 * The decision logic — Session 7's consumer, with everything that only existed because it was POLLING
 * taken out: no `since` cursor, no createdAt query, no batch loop, no /process endpoint, no "who calls
 * this?". What is left is what the rule always was.
 *
 * Idempotency here is STATELESS and that is deliberate: no local dedup store, no processed-ids table.
 * The order's own state is the record of whether the work happened, and Session 6 made the State machine
 * guarded precisely so that "already picked" is a fact you can read rather than a race you must survive.
 * A local store would be a second source of truth that can disagree with the first.
 */
export type Outcome =
  /** Acknowledge (2xx): the queue discards the message. */
  | { ack: true; detail: string }
  /** Fail (anything else): the platform redelivers, for up to 7 days. */
  | { ack: false; detail: string };

export interface Deps {
  targetStateKey: string;
  confirmOrderState: boolean;
  maxMessageAgeHours: number;
  loadOrder(orderId: string): Promise<OrderSnapshot | null>;
  transition(order: OrderSnapshot, stateKey: string, confirmOrderState: boolean): Promise<TransitionResult>;
  now?(): Date;
}

/** Only these reach the handler; the Subscription asks for no others. */
export const HANDLED_TYPES = ['OrderPaymentStateChanged'] as const;

export async function handleMessage(message: PlatformMessage, deps: Deps): Promise<Outcome> {
  // A Subscription has NO condition — unlike an API Extension, there is no predicate to narrow it, so
  // the queue delivers everything the Subscription asked for and filtering is the handler's job. This
  // also catches the platform's own test notification, sent when a Subscription is created.
  if (!HANDLED_TYPES.includes(message.type as (typeof HANDLED_TYPES)[number])) {
    return { ack: true, detail: `type ${message.type} is not handled` };
  }
  if (message.paymentState !== 'Paid') {
    return { ack: true, detail: `paymentState ${message.paymentState ?? 'absent'} — nothing to do` };
  }

  // A backlog guard. Unacknowledged messages live for 7 days, so a handler that was broken over a
  // weekend comes back to a stampede of stale work. Fulfilling an order somebody already cancelled by
  // hand three days ago is worse than dropping the message and saying so.
  const ageHours = messageAgeHours(message, deps.now?.() ?? new Date());
  if (ageHours !== undefined && ageHours > deps.maxMessageAgeHours) {
    return { ack: true, detail: `message is ${Math.round(ageHours)}h old (limit ${deps.maxMessageAgeHours}h) — dropped` };
  }

  const orderId = message.resource?.id;
  if (!orderId) return { ack: true, detail: 'message carries no order reference' };

  // Re-fetch by id rather than trusting the payload: it may be stale, and when the message exceeded the
  // queue's size limit the fields are replaced by `payloadNotIncluded` and simply are not there.
  const order = await deps.loadOrder(orderId);
  if (!order) return { ack: true, detail: `order ${orderId} not found — dropped` };

  if (order.stateKey === deps.targetStateKey) {
    return { ack: true, detail: `${order.orderNumber ?? order.id} is already ${deps.targetStateKey}` };
  }

  const result = await deps.transition(order, deps.targetStateKey, deps.confirmOrderState);
  if (result.ok) return { ack: true, detail: `${order.orderNumber ?? order.id} -> ${deps.targetStateKey}` };
  if (result.permanent) return { ack: true, detail: `refused permanently: ${result.detail}` };
  return { ack: false, detail: `transient failure: ${result.detail}` };
}

function messageAgeHours(message: PlatformMessage, now: Date): number | undefined {
  if (!message.createdAt) return undefined;
  const created = Date.parse(message.createdAt);
  if (Number.isNaN(created)) return undefined;
  return (now.getTime() - created) / 3_600_000;
}
