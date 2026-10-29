import { describe, expect, it } from 'vitest';
import type { Cart } from '@commercetools/platform-sdk';
import { applyRules, TYPE_KEY, WHITE_GLOVE_FIELD } from '../src/services/cart-rules.service.js';

const cfg = { maxQuantityPerLine: 10, whiteGloveThresholdCents: 40000 };

// custom: 'none' = no Custom Type at all; 'typed' = order-extras attached, flag unset; 'flagged' = flag set.
const cart = (lines: Array<{ qty: number; cents: number; sku?: string }>, flagged = false, custom: 'none' | 'typed' = 'typed'): Cart =>
  ({
    id: 'cart-1',
    version: 1,
    lineItems: lines.map((l, i) => ({
      id: `li-${i}`,
      quantity: l.qty,
      variant: { id: 1, sku: l.sku ?? 'CARM-023' },
      price: { id: 'p', value: { type: 'centPrecision', currencyCode: 'EUR', centAmount: l.cents, fractionDigits: 2 } },
    })),
    ...(flagged
      ? { custom: { type: { typeId: 'type', id: 't' }, fields: { [WHITE_GLOVE_FIELD]: true } } }
      : custom === 'typed'
        ? { custom: { type: { typeId: 'type', id: 't' }, fields: { owner: 'p1' } } }
        : {}),
  }) as unknown as Cart;

describe('cart rules — validation', () => {
  it('rejects a line over the maximum, with our own message and the offending SKU', () => {
    const r = applyRules(cart([{ qty: 11, cents: 49900 }]), cfg);
    expect(r.status).toBe(400);
    if (r.status !== 400) throw new Error('unreachable');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.code).toBe('InvalidInput');
    expect(r.errors[0]!.message).toContain('Max 10 units per line (CARM-023 has 11)');
    expect(r.errors[0]!.extensionExtraInfo).toMatchObject({ sku: 'CARM-023', quantity: 11, max: 10 });
  });

  it('reports every offending line, not just the first', () => {
    const r = applyRules(cart([{ qty: 11, cents: 100, sku: 'A' }, { qty: 40, cents: 100, sku: 'B' }]), cfg);
    if (r.status !== 400) throw new Error('expected a rejection');
    expect(r.errors.map((e) => e.extensionExtraInfo?.sku)).toEqual(['A', 'B']);
  });

  it('allows exactly the maximum — the boundary is inclusive', () => {
    expect(applyRules(cart([{ qty: 10, cents: 100 }]), cfg).status).toBe(200);
  });

  it('never mixes rejection with enrichment', () => {
    const r = applyRules(cart([{ qty: 11, cents: 49900 }]), cfg);
    expect(r).not.toHaveProperty('actions');
  });
});

describe('cart rules — enrichment is a delta', () => {
  it('sets the flag when a line reaches the threshold', () => {
    const r = applyRules(cart([{ qty: 1, cents: 40000 }]), cfg);
    if (r.status !== 200) throw new Error('unreachable');
    expect(r.actions).toEqual([{ action: 'setCustomField', name: WHITE_GLOVE_FIELD, value: true }]);
  });

  it('attaches order-extras when the cart has no Custom Type — setCustomField alone is refused', () => {
    // The recurring-line case: a €449 subscription price on a cart nobody stamped.
    const r = applyRules(cart([{ qty: 1, cents: 44900 }], false, 'none'), cfg);
    if (r.status !== 200) throw new Error('unreachable');
    expect(r.actions).toEqual([
      { action: 'setCustomType', type: { typeId: 'type', key: TYPE_KEY }, fields: { [WHITE_GLOVE_FIELD]: true } },
    ]);
  });

  it('a cheap cart with no Custom Type gets nothing — the type is only attached to set the flag', () => {
    const r = applyRules(cart([{ qty: 1, cents: 2599 }], false, 'none'), cfg);
    if (r.status !== 200) throw new Error('unreachable');
    expect(r.actions).toEqual([]);
  });

  it('returns NO actions when the flag is already correct — no write amplification', () => {
    const set = applyRules(cart([{ qty: 1, cents: 49900 }], true), cfg);
    const unset = applyRules(cart([{ qty: 2, cents: 2599 }]), cfg);
    if (set.status !== 200 || unset.status !== 200) throw new Error('unreachable');
    expect(set.actions).toEqual([]);
    expect(unset.actions).toEqual([]);
  });

  it('clears the flag when no line qualifies any more', () => {
    const r = applyRules(cart([{ qty: 2, cents: 2599 }], true), cfg);
    if (r.status !== 200) throw new Error('unreachable');
    expect(r.actions).toEqual([{ action: 'setCustomField', name: WHITE_GLOVE_FIELD }]);
    expect(r.actions[0]).not.toHaveProperty('value');
  });

  it('handles an empty cart', () => {
    const r = applyRules(cart([]), cfg);
    if (r.status !== 200) throw new Error('unreachable');
    expect(r.actions).toEqual([]);
  });
});
