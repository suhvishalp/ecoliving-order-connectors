import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Unauthorized } from '../errors/custom.error.js';
import { readConfiguration } from '../utils/config.utils.js';

/**
 * The endpoint is on the public internet: anyone who learns the URL can POST a forged cart. So the
 * Extension is REGISTERED with an `AuthorizationHeader` destination (connector/actions.ts) and the
 * value is verified HERE. Registration alone is not security — it only makes the platform send the
 * header; something has to check it.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const presented = req.get('authorization');
  const expected = `Bearer ${readConfiguration().extensionSecret}`;
  if (!presented || !safeEqual(presented, expected)) {
    next(new Unauthorized('Missing or invalid Authorization header.'));
    return;
  }
  next();
}

/** Constant-time compare, so the response time cannot be used to guess the secret byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
