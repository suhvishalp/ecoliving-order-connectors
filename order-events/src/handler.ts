/**
 * Session 8.3 — Session 7's poll loop, rewritten for push.
 *
 * Put this beside the BFF's EventConsumerService.java and notice what is GONE: no `since` cursor, no
 * createdAt query, no batch loop, no /process endpoint, no "who calls this?". All of that existed only
 * because nothing was pushing. What survives is the decision logic — and the dedupe, because
 * at-least-once is still the promise.
 */
export interface PlatformMessage {
  id: string;
  type: string;
  sequenceNumber?: number;
  resourceVersion?: number;
  resource?: { typeId: string; id: string };
  orderNumber?: string;
  paymentState?: string;
}

export type Outcome =
  /** Acknowledge: the world is as it should be. The queue discards the message. */
  | { ack: true; detail: string }
  /** Fail: the platform redelivers. Unacknowledged messages are retained for 7 days. */
  | { ack: false; detail: string };

export interface Deps {
  transition(orderNumber: string, stateKey: string): Promise<{ status: number; body: string }>;
  orderNumberFor(orderId: string): Promise<string | null>;
  targetState: string;
}

export async function handle(message: PlatformMessage, deps: Deps): Promise<Outcome> {
  // Not a type we act on -> acknowledge immediately. The queue delivers everything the Subscription
  // asked for; filtering is the handler's job, and a nack here would retry forever.
  if (message.type !== 'OrderPaymentStateChanged') {
    return { ack: true, detail: `type ${message.type} not handled` };
  }
  if (message.paymentState !== 'Paid') {
    return { ack: true, detail: `paymentState ${message.paymentState} — nothing to do` };
  }

  const orderId = message.resource?.id;
  if (!orderId) return { ack: true, detail: 'message carries no order reference' };

  const orderNumber = message.orderNumber ?? (await deps.orderNumberFor(orderId));
  if (!orderNumber) {
    // Permanent, not transient: retrying for 7 days will not conjure an order number.
    return { ack: true, detail: `order ${orderId} has no orderNumber — dropped (see the dead-letter policy)` };
  }

  const res = await deps.transition(orderNumber, deps.targetState);
  if (res.status >= 200 && res.status < 300) {
    return { ack: true, detail: `${orderNumber} -> ${deps.targetState}` };
  }
  if (res.status === 409) {
    // The state machine refused: the order is already past this state. That is the dedupe, for free —
    // and it is why Session 6 built a guarded machine rather than if-chains.
    return { ack: true, detail: `${orderNumber} already past ${deps.targetState}` };
  }
  // Transient: let the platform redeliver.
  return { ack: false, detail: `transition failed: HTTP ${res.status} ${res.body}` };
}

/** Connect delivers a base64-encoded Pub/Sub envelope. Locally you POST the same shape by hand. */
export function decode(body: unknown): PlatformMessage {
  const data = (body as { message?: { data?: string } })?.message?.data;
  if (!data) throw new Error('No message.data in the envelope');
  return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as PlatformMessage;
}
