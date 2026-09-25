import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';
import { ensureCartRulesExtension } from './actions.js';

/**
 * Runs after a successful deploy. Connect injects CONNECT_SERVICE_URL — this application's own public
 * URL — so the Extension registers itself and can never drift from what is actually running.
 */
async function run(): Promise<void> {
  const serviceUrl = process.env.CONNECT_SERVICE_URL;
  if (!serviceUrl) throw new Error('CONNECT_SERVICE_URL is not set — is this a `service` application?');

  // Validate configuration and credentials BEFORE registering anything. A deploy that registers an
  // Extension it cannot serve is worse than a deploy that fails: it breaks every cart write instead of
  // showing up red in the deployment log.
  const { extensionSecret } = readConfiguration();
  const apiRoot = createApiRoot();
  await apiRoot.get().execute();
  logger.info('postDeploy: credentials verified');

  await ensureCartRulesExtension(apiRoot, `${serviceUrl}/cart-rules`, extensionSecret);
}

run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
