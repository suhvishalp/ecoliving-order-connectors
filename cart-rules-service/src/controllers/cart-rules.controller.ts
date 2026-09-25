import type { Request, Response } from 'express';
import type { Cart } from '@commercetools/platform-sdk';
import { CustomError } from '../errors/custom.error.js';
import { applyRules } from '../services/cart-rules.service.js';
import { readThresholds } from '../services/thresholds.service.js';
import { logger } from '../utils/logger.utils.js';

/**
 * Translates one API Extension call into one rule evaluation.
 *
 * The contract is narrow and unforgiving: 200/201 (optionally with `actions`) approves the write, 400
 * with `errors` rejects it with your message, and ANY other status — 500, a timeout, an HTML error page
 * — fails the caller's write with ExtensionBadResponse.
 */
export async function post(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  const { action, resource } = req.body ?? {};

  if (!action || !resource) {
    throw new CustomError(400, 'Bad request — the Extension input is missing `action` or `resource`.', 'InvalidInput');
  }
  if (resource.typeId !== 'cart') {
    throw new CustomError(400, `Expected a cart, received "${resource.typeId}".`, 'InvalidInput');
  }

  const cart = resource.obj as Cart | undefined;
  if (!cart) {
    // `obj` is the cart as it WOULD be saved. Without it there is nothing to judge, and re-fetching
    // would return the pre-update version — the wrong answer, bought with a network call we cannot
    // afford inside a 2-second budget. Approve and move on.
    logger.warn('Extension input carried no resource.obj — approving', {
      correlationId: req.correlationId,
      cartId: resource.id,
    });
    res.status(200).send();
    return;
  }

  const result = applyRules(cart, await readThresholds());
  logger.info('Cart evaluated', {
    correlationId: req.correlationId,
    action,
    cartId: cart.id,
    status: result.status,
    summary: result.summary,
    durationMs: Date.now() - started,
  });

  if (result.status === 400) {
    res.status(400).json({ errors: result.errors });
    return;
  }
  if (result.actions.length > 0) {
    res.status(200).json({ actions: result.actions });
    return;
  }
  res.status(200).send();
}
