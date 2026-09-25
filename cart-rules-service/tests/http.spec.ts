import { beforeEach, describe, expect, it, vi } from 'vitest';

// The thresholds service reaches for a Custom Object; stub it so these tests exercise the HTTP layer
// (auth, contract, status codes) rather than the platform.
vi.mock('../src/services/thresholds.service.js', () => ({
  readThresholds: async () => ({ maxQuantityPerLine: 10, whiteGloveThresholdCents: 40000 }),
}));

process.env.CTP_PROJECT_KEY ??= 'test-project';
process.env.CTP_CLIENT_ID ??= 'test-id';
process.env.CTP_CLIENT_SECRET ??= 'test-secret';
process.env.CTP_API_URL ??= 'https://api.europe-west1.gcp.commercetools.com';
process.env.CTP_AUTH_URL ??= 'https://auth.europe-west1.gcp.commercetools.com';
process.env.EXTENSION_SECRET = 's3cret';
process.env.NODE_ENV = 'test';

const request = (await import('supertest')).default;
const app = (await import('../src/index.js')).default;

const AUTH = { Authorization: 'Bearer s3cret' };
const input = (qty: number, cents: number, flagged = false) => ({
  action: 'Update',
  resource: {
    typeId: 'cart',
    id: 'cart-1',
    obj: {
      id: 'cart-1',
      version: 1,
      lineItems: [
        {
          id: 'li-1',
          quantity: qty,
          variant: { id: 1, sku: 'CARM-023' },
          price: { id: 'p', value: { type: 'centPrecision', currencyCode: 'EUR', centAmount: cents, fractionDigits: 2 } },
        },
      ],
      ...(flagged ? { custom: { type: { typeId: 'type', id: 't' }, fields: { requiresWhiteGlove: true } } } : {}),
    },
  },
});

describe('authentication — the endpoint is on the public internet', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['no Authorization header', undefined],
    ['an empty header', ''],
    ['the wrong secret', 'Bearer wrong'],
    ['the right secret without the Bearer scheme', 's3cret'],
    ['a lowercase scheme', 'bearer s3cret'],
    ['the secret as Basic auth', 'Basic czNjcmV0'],
  ])('rejects %s with 401', async (_label, header) => {
    const req = request(app).post('/cart-rules').send(input(1, 100));
    if (header !== undefined) req.set('Authorization', header);
    const res = await req;
    expect(res.status).toBe(401);
  });

  it('accepts the configured secret', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send(input(1, 100));
    expect(res.status).toBe(200);
  });

  it('leaves /status open — it exposes nothing', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('the API Extension contract', () => {
  it('answers 400 with errors when a rule rejects the cart', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send(input(11, 49900));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('InvalidInput');
  });

  it('answers 200 with actions when it enriches', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send(input(1, 49900));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ actions: [{ action: 'setCustomField', name: 'requiresWhiteGlove', value: true }] });
  });

  it('answers 200 with an EMPTY body when nothing needs to change', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send(input(1, 49900, true));
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  it('rejects a malformed input with 400, not 500 — a 500 would fail the shopper’s write', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send({ action: 'Update' });
    expect(res.status).toBe(400);
  });

  it('approves when resource.obj is absent rather than failing the write', async () => {
    const res = await request(app)
      .post('/cart-rules').set(AUTH)
      .send({ action: 'Update', resource: { typeId: 'cart', id: 'cart-1' } });
    expect(res.status).toBe(200);
  });

  it('rejects a non-cart resource', async () => {
    const res = await request(app)
      .post('/cart-rules').set(AUTH)
      .send({ action: 'Update', resource: { typeId: 'order', id: 'o-1', obj: {} } });
    expect(res.status).toBe(400);
  });

  it('echoes the correlation id the platform sent', async () => {
    const res = await request(app)
      .post('/cart-rules').set(AUTH).set('X-Correlation-ID', 'abc-123').send(input(1, 100));
    expect(res.headers['x-correlation-id']).toBe('abc-123');
  });

  it('never leaks a stack trace', async () => {
    const res = await request(app).post('/cart-rules').set(AUTH).send({ action: 'Update' });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:/);
  });
});
