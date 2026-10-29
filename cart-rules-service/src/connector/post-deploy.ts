import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';
import { assertWhiteGloveType, ensureCartRulesExtension } from './actions.js';

/**
 * Runs after a successful deploy. Connect injects CONNECT_SERVICE_URL — this application's own public
 * URL — so the Extension registers itself and can never drift from what is actually running.
 */
/**
 * Connect's CONNECT_SERVICE_URL already ends with the application's `endpoint` from connect.yaml (the deploy log
 * says "provisioned successfully at https://service-….commercetools.app/<endpoint>"). Appending the endpoint again
 * registers `/<endpoint>/<endpoint>`, which 404s. Accept both shapes so local runs with a bare host still work.
 */
export function extensionUrl(serviceUrl: string, endpoint: string): string {
  const base = serviceUrl.replace(/\/+$/, '');
  return base.endsWith(endpoint) ? base : `${base}${endpoint}`;
}

async function run(): Promise<void> {
  const serviceUrl = process.env.CONNECT_SERVICE_URL;
  if (!serviceUrl) throw new Error('CONNECT_SERVICE_URL is not set — is this a `service` application?');

  // Validate configuration and credentials BEFORE registering anything. A deploy that registers an
  // Extension it cannot serve is worse than a deploy that fails: it breaks every cart write instead of
  // showing up red in the deployment log.
  const { extensionSecret } = readConfiguration();
  const apiRoot = createApiRoot();
  // Verify the credentials with a call INSIDE the generated client's scopes. Reading the Project (GET /{projectKey})
  // needs view_project_settings, which inheritAs does not grant: that 403 failed every postDeploy silently.
  await apiRoot.extensions().get({ queryArgs: { limit: 1 } }).execute();
  logger.info('postDeploy: credentials verified');
  await assertWhiteGloveType(apiRoot);
  logger.info('postDeploy: order-extras Type present');

  await ensureCartRulesExtension(apiRoot, extensionUrl(serviceUrl, '/cart-rules'), extensionSecret);
}

/* c8 ignore next */
if (process.env.NODE_ENV !== 'test') run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
