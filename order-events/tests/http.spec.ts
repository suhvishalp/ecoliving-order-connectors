import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/create.client.js', () => ({ createApiRoot: () => ({}) }));
vi.mock('../src/services/order.service.js', () => ({
  loadOrder: async () => ({ id: 'o1', version: 1, orderNumber: 'LHC-1', stateKey: 'order-placed' }),
  transitionOrder: async () => ({ ok: true }),
}));

process.env.CTP_PROJECT_KEY ??= 'test-project';
process.env.CTP_CLIENT_ID ??= 'id';
process.env.CTP_CLIENT_SECRET ??= 'secret';
process.env.CTP_API_URL ??= 'https://api.europe-west1.gcp.commercetools.com';
process.env.CTP_AUTH_URL ??= 'https://auth.europe-west1.gcp.commercetools.com';
process.env.NODE_ENV = 'test';

const request = (await import('supertest')).default;
const app = (await import('../src/index.js')).default;

const envelope = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
});

describe('the acknowledgement contract over HTTP', () => {
  it('204s a handled message — the queue discards it', async () => {
    const res = await request(app)
      .post('/order-events')
      .send(envelope({ id: 'm1', type: 'OrderPaymentStateChanged', paymentState: 'Paid', resource: { typeId: 'order', id: 'o1' } }));
    expect(res.status).toBe(204);
  });

  it('204s a message type it does not handle — a nack would retry it for 7 days', async () => {
    const res = await request(app).post('/order-events').send(envelope({ id: 'm2', type: 'OrderCreated' }));
    expect(res.status).toBe(204);
  });

  it('204s a malformed envelope — it can never succeed, so redelivery is pointless', async () => {
    const res = await request(app).post('/order-events').send({ nope: true });
    expect(res.status).toBe(204);
  });

  it('exposes /status for liveness', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
  });
});
