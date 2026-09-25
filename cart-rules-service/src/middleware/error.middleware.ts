import type { NextFunction, Request, Response } from 'express';
import { CustomError } from '../errors/custom.error.js';
import { logger } from '../utils/logger.utils.js';

/**
 * The last line of defence, and a security boundary: a stack trace in a response body tells an attacker
 * your framework, your paths and often your dependencies. Log the detail; return a sentence.
 *
 * Note what an unexpected error means HERE: anything that is not 200/201/400 fails the CALLER's write.
 * So a bug in this handler becomes a shopper unable to add to cart — which is why the route itself
 * decides fail-open explicitly rather than leaving it to this middleware.
 */
export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId;

  if (error instanceof CustomError) {
    logger.warn('Request rejected', { correlationId, status: error.statusCode, code: error.code });
    res.status(error.statusCode).json({
      errors: [{ code: error.code, message: error.message, ...(error.extensionExtraInfo ?? {}) }],
    });
    return;
  }

  logger.error('Unhandled error', { correlationId, reason: error.message, stack: error.stack });
  res.status(500).json({ errors: [{ code: 'General', message: 'Internal server error.' }] });
}
