import type { Cart, CartUpdateAction } from '@commercetools/platform-sdk';

/**
 * LHC's two cart rules — the business logic, and nothing else. No Express, no SDK calls, no I/O, so it
 * can be read in one sitting and tested without a platform.
 *
 * These are the same rules the BFF enforces in Java in Session 7.7. That is the point of the session:
 * moving a rule from your own service to a platform-hosted one changes WHERE it runs, not what it decides.
 */
export const WHITE_GLOVE_FIELD = 'requiresWhiteGlove';

export interface Thresholds {
  maxQuantityPerLine: number;
  whiteGloveThresholdCents: number;
}

export interface ExtensionError {
  code: string;
  message: string;
  localizedMessage?: Record<string, string>;
  extensionExtraInfo?: Record<string, unknown>;
}

export type RuleResult =
  | { status: 200; actions: CartUpdateAction[]; summary: string }
  | { status: 400; errors: ExtensionError[]; summary: string };

export function applyRules(cart: Cart, cfg: Thresholds): RuleResult {
  const lines = cart.lineItems ?? [];

  // 1. VALIDATE. One error per offending line; the client's write fails with our message, on every
  //    channel — the storefront, an import, Merchant Center. Validation and enrichment are never mixed:
  //    a rejected write must not also request changes.
  const errors: ExtensionError[] = lines
    .filter((li) => li.quantity > cfg.maxQuantityPerLine)
    .map((li) => ({
      code: 'InvalidInput',
      message: `Max ${cfg.maxQuantityPerLine} units per line (${li.variant?.sku ?? 'unknown SKU'} has ${li.quantity}).`,
      localizedMessage: {
        'en-US': `You can order at most ${cfg.maxQuantityPerLine} of ${li.variant?.sku ?? 'this item'} per line.`,
      },
      extensionExtraInfo: { sku: li.variant?.sku, quantity: li.quantity, max: cfg.maxQuantityPerLine },
    }));

  if (errors.length > 0) {
    return { status: 400, errors, summary: `${errors.length} line(s) over ${cfg.maxQuantityPerLine}` };
  }

  // 2. ENRICH — as a DELTA. Compute the desired end state, then return only what differs from it. The
  //    Extension fires on every cart update, so returning "set it again" on an unchanged cart would cost
  //    the platform a write on every keystroke and make this rule its own trigger.
  const needsWhiteGlove = lines.some(
    (li) => (li.price?.value?.centAmount ?? 0) >= cfg.whiteGloveThresholdCents
  );
  const alreadyFlagged = cart.custom?.fields?.[WHITE_GLOVE_FIELD] === true;

  if (needsWhiteGlove && !alreadyFlagged) {
    return {
      status: 200,
      actions: [{ action: 'setCustomField', name: WHITE_GLOVE_FIELD, value: true }],
      summary: 'white glove set',
    };
  }
  if (!needsWhiteGlove && alreadyFlagged) {
    // setCustomField with no `value` removes the field.
    return {
      status: 200,
      actions: [{ action: 'setCustomField', name: WHITE_GLOVE_FIELD }],
      summary: 'white glove cleared',
    };
  }
  return { status: 200, actions: [], summary: needsWhiteGlove ? 'white glove already set' : 'no change' };
}
