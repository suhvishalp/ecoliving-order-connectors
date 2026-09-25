import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { logger } from '../utils/logger.utils.js';
import { readConfiguration } from '../utils/config.utils.js';
import { buildDestination, ensureOrderEventsSubscription } from './actions.js';

/**
 * The Subscription that Session 7 could not create. Everything 7.5 taught as a concept — a
 * MessageSubscription, its resourceTypeId and types, at-least-once and unordered delivery — is the code
 * below. Connect provisioned the queue; we still write the Subscription, which is why that concept-only
 * session was not wasted.
 */
async function run(): Promise<void> {
  readConfiguration();
  const apiRoot = createApiRoot();
  await apiRoot.get().execute();
  logger.info('postDeploy: credentials verified');

  await ensureOrderEventsSubscription(apiRoot, buildDestination());
}

run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
