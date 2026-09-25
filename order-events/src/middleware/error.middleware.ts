import type { NextFunction, Request, Response } from 'express';
import { CustomError } from '../errors/custom.error.js';
import { logger } from '../utils/logger.utils.js';

/**
 * For an EVENT application the status code is not cosmetic — it is the acknowledgement.
 *
 * A malformed envelope is permanent: redelivering it for seven days changes nothing, so we acknowledge
 * (204) and log loudly. Anything unexpected is assumed transient and nacked (500), because losing a
 * real order event is worse than processing one twice — the handler is idempotent by design.
 */
export function errorMiddleware(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof CustomError && error.statusCode === 400) {
    logger.error('Malformed message acknowledged and dropped — it can never succeed', { reason: error.message });
    res.status(204).send();
    return;
  }
  logger.error('Unhandled error — nacking so the platform redelivers', { reason: error.message, stack: error.stack });
  res.status(500).send();
}
