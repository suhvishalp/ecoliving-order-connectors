import { CustomError } from '../errors/custom.error.js';

/**
 * Decoding and validating what arrives on the wire.
 *
 * The event endpoint is reached by Connect's own message broker, and there is no shared secret on that
 * hop to check (a Subscription's destination is a private topic, not an HTTP URL you authenticate). So
 * the defence here is different from the service application's: validate the envelope strictly, act only
 * on the message types we subscribed to, and make every effect idempotent — so even a forged or replayed
 * delivery cannot do damage.
 */
export interface PlatformMessage {
  id: string;
  type: string;
  createdAt?: string;
  sequenceNumber?: number;
  resourceVersion?: number;
  resource?: { typeId: string; id: string };
  paymentState?: string;
  /** Present when the payload exceeded the queue's size limit — re-fetch instead of trusting fields. */
  payloadNotIncluded?: { reason: string; payloadType: string };
}

/**
 * Connect delivers a base64-encoded Pub/Sub envelope: `{ message: { data: "<base64 JSON>" } }`.
 * Locally you POST exactly that shape by hand (see the README), which is why the local test is worth
 * something: the handler never learns whether a queue or a curl produced it.
 */
export function decodeEnvelope(body: unknown): PlatformMessage {
  const data = (body as { message?: { data?: unknown } })?.message?.data;
  if (typeof data !== 'string' || data.length === 0) {
    throw new CustomError(400, 'Malformed envelope: message.data is missing.', 'InvalidInput');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    throw new CustomError(400, 'Malformed envelope: message.data is not base64-encoded JSON.', 'InvalidInput');
  }

  const message = parsed as PlatformMessage;
  if (!message || typeof message.id !== 'string' || typeof message.type !== 'string') {
    throw new CustomError(400, 'Malformed message: `id` and `type` are required.', 'InvalidInput');
  }
  return message;
}
