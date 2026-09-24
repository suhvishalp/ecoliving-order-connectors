import type { Cart, CartUpdateAction } from '@commercetools/platform-sdk';

/**
 * Session 8.2 — the cart rules, unchanged in substance from Session 7.7.
 *
 * Read that again: unchanged. The whole lesson of this application is that moving a handler from a
 * laptop behind a tunnel to a platform-hosted service changes WHERE it runs and nothing about WHAT
 * it decides. Compare this file to the BFF's CartRulesHandler.java — same two rules, same
 * delta-only enrichment, same 400-with-your-message.
 */
export const WHITE_GLOVE_FIELD = 'requiresWhiteGlove';

export interface Thresholds {
  maxQuantityPerLine: number;
  whiteGloveThresholdCents: number;
}

export type RuleResult =
  | { status: 200; body?: { actions: CartUpdateAction[] }; summary: string }
  | { status: 400; body: { errors: ExtensionError[] }; summary: string };

interface ExtensionError {
  code: string;
  message: string;
  localizedMessage?: Record<string, string>;
  extensionExtraInfo?: Record<string, unknown>;
}

export function applyRules(cart: Cart, cfg: Thresholds): RuleResult {
  const lines = cart.lineItems ?? [];

  // 1. Validate — reject, with one error per offending line. The client's write fails with OUR message,
  //    on every channel, Merchant Center included.
  const errors: ExtensionError[] = lines
    .filter((li) => li.quantity > cfg.maxQuantityPerLine)
    .map((li) => ({
      code: 'InvalidInput',
      message: `Max ${cfg.maxQuantityPerLine} units per line (${li.variant?.sku ?? '?'} has ${li.quantity}).`,
      localizedMessage: {
        'en-US': `You can order at most ${cfg.maxQuantityPerLine} of ${li.variant?.sku ?? 'this item'} per line.`,
      },
      extensionExtraInfo: { sku: li.variant?.sku, quantity: li.quantity, max: cfg.maxQuantityPerLine },
    }));
  if (errors.length > 0) {
    return { status: 400, body: { errors }, summary: `${errors.length} line(s) over ${cfg.maxQuantityPerLine}` };
  }

  // 2. Enrich — compute the desired end state, return actions ONLY for the delta, so every repeated
  //    Update is idempotent and an unchanged cart costs the platform nothing.
  const needs = lines.some((li) => (li.price?.value?.centAmount ?? 0) >= cfg.whiteGloveThresholdCents);
  const has = cart.custom?.fields?.[WHITE_GLOVE_FIELD] === true;

  if (needs && !has) {
    return {
      status: 200,
      body: { actions: [{ action: 'setCustomField', name: WHITE_GLOVE_FIELD, value: true }] },
      summary: 'white glove set',
    };
  }
  if (!needs && has) {
    return {
      status: 200,
      body: { actions: [{ action: 'setCustomField', name: WHITE_GLOVE_FIELD }] }, // no value = remove
      summary: 'white glove cleared',
    };
  }
  return { status: 200, summary: needs ? 'white glove already set' : 'nothing to change' };
}
