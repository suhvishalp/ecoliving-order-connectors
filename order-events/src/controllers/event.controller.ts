import type { Request, Response } from 'express';
import { createApiRoot } from '../client/create.client.js';
import { decodeEnvelope } from '../services/envelope.service.js';
import { handleMessage, type Deps } from '../services/fulfilment.service.js';
import { loadOrder, transitionOrder } from '../services/order.service.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';

/**
 * The acknowledgement contract, which is the whole job:
 *   102 / 200 / 201 / 202 / 204  -> the queue DISCARDS the message.
 *   anything else                -> the queue REDELIVERS it, for up to 7 days.
 * There is no third option, so "log the error and return 200" is a decision to drop data. Make it on
 * purpose, in the handler, per failure — never by accident in a catch-all.
 */
export async function post(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  const config = readConfiguration();

  const message = decodeEnvelope(req.body);
  const context = {
    messageId: message.id,
    type: message.type,
    resourceId: message.resource?.id,
    sequenceNumber: message.sequenceNumber,
  };

  const apiRoot = createApiRoot();
  const deps: Deps = {
    targetStateKey: config.targetStateKey,
    confirmOrderState: config.confirmOrderState,
    maxMessageAgeHours: config.maxMessageAgeHours,
    loadOrder: (orderId) => loadOrder(apiRoot, orderId),
    transition: (order, stateKey, confirm) => transitionOrder(apiRoot, order, stateKey, confirm),
  };

  const outcome = await handleMessage(message, deps);
  logger.info('Message handled', { ...context, ack: outcome.ack, detail: outcome.detail, durationMs: Date.now() - started });

  // 204: acknowledged, nothing to return. 500: please send it again.
  res.status(outcome.ack ? 204 : 500).send();
}
