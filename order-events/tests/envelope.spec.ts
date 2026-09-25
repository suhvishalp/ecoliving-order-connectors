import { describe, expect, it } from 'vitest';
import { decodeEnvelope } from '../src/services/envelope.service.js';
import { CustomError } from '../src/errors/custom.error.js';

const envelope = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
});

describe('envelope decoding', () => {
  it('decodes the base64 Pub/Sub envelope Connect delivers', () => {
    const m = decodeEnvelope(envelope({ id: 'm1', type: 'OrderPaymentStateChanged', paymentState: 'Paid' }));
    expect(m).toMatchObject({ id: 'm1', type: 'OrderPaymentStateChanged' });
  });

  it.each([
    ['an empty body', {}],
    ['no message', { notAMessage: true }],
    ['no data', { message: {} }],
    ['data that is not a string', { message: { data: 42 } }],
    ['data that is not base64 JSON', { message: { data: 'bm90LWpzb24=' } }],
    ['JSON without id/type', envelope({ paymentState: 'Paid' })],
  ])('rejects %s as a 400 — permanent, so the caller can drop it', (_label, body) => {
    try {
      decodeEnvelope(body);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomError);
      expect((error as CustomError).statusCode).toBe(400);
    }
  });
});
