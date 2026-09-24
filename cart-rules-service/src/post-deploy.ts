import 'dotenv/config';
import { apiRoot } from './client.js';

/**
 * Session 8.2 / 9.2 — infrastructure as code.
 *
 * Connect runs this AFTER a successful deploy and hands it CONNECT_SERVICE_URL: the application's own
 * public URL. Session 7 had a human paste a tunnel URL into an ExtensionDraft; here the deployment
 * registers itself, so the Extension can never drift from what is actually running.
 *
 * Delete-then-create, because a redeploy runs this again and a blind create fails on the duplicate key.
 */
const EXTENSION_KEY = 'lhc-cart-rules';

async function run(): Promise<void> {
  const serviceUrl = process.env.CONNECT_SERVICE_URL;
  if (!serviceUrl) throw new Error('CONNECT_SERVICE_URL is not set — is this a service application?');

  const existing = await apiRoot.extensions().withKey({ key: EXTENSION_KEY }).get().execute()
    .then((r) => r.body)
    .catch(() => null);

  if (existing) {
    await apiRoot.extensions().withKey({ key: EXTENSION_KEY })
      .delete({ queryArgs: { version: existing.version } }).execute();
  }

  await apiRoot.extensions().post({
    body: {
      key: EXTENSION_KEY,
      destination: { type: 'HTTP', url: `${serviceUrl}/cart-rules` },
      triggers: [{ resourceTypeId: 'cart', actions: ['Create', 'Update'] }],
      timeoutInMs: 2000,
    },
  }).execute();

  console.log(`postDeploy: Extension '${EXTENSION_KEY}' -> ${serviceUrl}/cart-rules`);
}

run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
