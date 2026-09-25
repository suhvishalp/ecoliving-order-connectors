/**
 * Session 8.3 — Session 7's poll loop, rewritten for push.
 *
 * Put this beside the BFF's EventConsumerService.java and notice what is GONE: no `since` cursor, no
 * createdAt query, no batch loop, no /process endpoint, no "who calls this?". All of that existed only
 * because nothing was pushing. What survives is the decision logic — and the dedupe, because
 * at-least-once is still the promise.
 *
 * Note what it talks to. Session 7's consumer called the BFF's own order-state endpoint, because it ran
 * inside the BFF. A DEPLOYED connector cannot: it runs in Connect's cloud, and your BFF is on a laptop
 * that is not reachable from there. So it calls the commercetools API directly — which is the better
 * design anyway. A connector has no business depending on somebody's machine being awake.
 */
export interface PlatformMessage {
  id: string;
  type: string;
  sequenceNumber?: number;
  resourceVersion?: number;
  resource?: { typeId: string; id: string };
  paymentState?: string;
}

/** Just enough of the order to decide, and to write the update. */
export interface OrderSnapshot {
  id: string;
  version: number;
  orderNumber: string | null;
  stateKey: string | null;
}

export type TransitionResult =
  | { ok: true }
  /** permanent: retrying for 7 days will not help. transient: let the platform redeliver. */
  | { ok: false; permanent: boolean; detail: string };

export interface Deps {
  targetState: string;
  loadOrder(orderId: string): Promise<OrderSnapshot | null>;
  transition(order: OrderSnapshot, stateKey: string): Promise<TransitionResult>;
}

export type Outcome =
  /** Acknowledge: the world is as it should be. The queue discards the message. */
  | { ack: true; detail: string }
  /** Fail: the platform redelivers. Unacknowledged messages are retained for 7 days. */
  | { ack: false; detail: string };

export async function handle(message: PlatformMessage, deps: Deps): Promise<Outcome> {
  // A Subscription cannot be filtered — unlike an API Extension, there is no `condition`. The queue
  // delivers every type the Subscription asked for, so filtering is the handler's job. A nack here
  // would retry a message we are never going to act on, for seven days.
  if (message.type !== 'OrderPaymentStateChanged') {
    return { ack: true, detail: `type ${message.type} not handled` };
  }
  if (message.paymentState !== 'Paid') {
    return { ack: true, detail: `paymentState ${message.paymentState} — nothing to do` };
  }

  const orderId = message.resource?.id;
  if (!orderId) return { ack: true, detail: 'message carries no order reference' };

  const order = await deps.loadOrder(orderId);
  if (!order) {
    // Permanent: the order is gone. Redelivery cannot conjure it back.
    return { ack: true, detail: `order ${orderId} not found — dropped (see the dead-letter policy)` };
  }

  // The dedupe, for free. Session 6 built a GUARDED state machine, so "already picked" is a fact we can
  // read rather than a race we have to survive — and an at-least-once redelivery costs one GET.
  if (order.stateKey === deps.targetState) {
    return { ack: true, detail: `${order.orderNumber ?? order.id} already ${deps.targetState}` };
  }

  const result = await deps.transition(order, deps.targetState);
  if (result.ok) {
    return { ack: true, detail: `${order.orderNumber ?? order.id} -> ${deps.targetState}` };
  }
  if (result.permanent) {
    // e.g. the machine refuses the transition (a cancelled order). Retrying for 7 days is not a plan.
    return { ack: true, detail: `refused permanently: ${result.detail}` };
  }
  return { ack: false, detail: `transient failure: ${result.detail}` };
}

/** Connect delivers a base64-encoded Pub/Sub envelope. Locally you POST the same shape by hand. */
export function decode(body: unknown): PlatformMessage {
  const data = (body as { message?: { data?: string } })?.message?.data;
  if (!data) throw new Error('No message.data in the envelope');
  return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as PlatformMessage;
}
