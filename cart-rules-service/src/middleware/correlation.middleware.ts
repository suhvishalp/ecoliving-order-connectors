import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * The platform sends `X-Correlation-ID` on every Extension call. Capture it, echo it back, and put it on
 * every log line for this request — it is what lets you trace one failed cart write in Merchant Center
 * to one handler invocation in the Connect logs.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = req.get('x-correlation-id') ?? `local-${randomUUID()}`;
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  next();
}
