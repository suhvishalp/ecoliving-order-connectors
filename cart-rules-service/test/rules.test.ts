import { describe, expect, it } from 'vitest';
import type { Cart } from '@commercetools/platform-sdk';
import { applyRules } from '../src/rules.js';

const cfg = { maxQuantityPerLine: 10, whiteGloveThresholdCents: 40000 };

const cart = (quantity: number, centAmount: number, flagged = false): Cart =>
  ({
    id: 'cart-1', version: 1,
    lineItems: [{ id: 'li-1', quantity, variant: { id: 1, sku: 'CARM-023' },
                  price: { id: 'p1', value: { type: 'centPrecision', currencyCode: 'EUR', centAmount, fractionDigits: 2 } } }],
    custom: flagged ? { type: { typeId: 'type', id: 't' }, fields: { requiresWhiteGlove: true } } : undefined,
  } as unknown as Cart);

describe('cart rules (8.2 — the same rules as Session 7.7)', () => {
  it('rejects the 11th unit with our own message', () => {
    const r = applyRules(cart(11, 49900), cfg);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Max 10 units per line');
  });

  it('sets white glove for a line at or above the threshold', () => {
    const r = applyRules(cart(1, 49900), cfg);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain('"value":true');
  });

  it('returns no actions when the flag is already correct — no write amplification', () => {
    expect(applyRules(cart(1, 49900, true), cfg).body).toBeUndefined();
    expect(applyRules(cart(2, 2599), cfg).body).toBeUndefined();
  });

  it('clears the flag when no line qualifies any more', () => {
    const r = applyRules(cart(2, 2599, true), cfg);
    expect(JSON.stringify(r.body)).toContain('setCustomField');
    expect(JSON.stringify(r.body)).not.toContain('"value":true');
  });
});
