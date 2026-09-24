import 'dotenv/config';
import { apiRoot } from './client.js';

/**
 * Session 9.2 — the marquee, and not housekeeping.
 *
 * An Extension left behind after teardown points at a deployment that no longer answers, so EVERY cart
 * write on the project fails on a 2-second timeout — for the next cohort, weeks later, with nothing to
 * connect it to. Undeploying cleanly is the difference between a demo and something you would run.
 *
 * Idempotent: deleting something already gone must not throw, or a half-failed teardown strands the rest.
 */
const EXTENSION_KEY = 'lhc-cart-rules';

async function run(): Promise<void> {
  const existing = await apiRoot.extensions().withKey({ key: EXTENSION_KEY }).get().execute()
    .then((r) => r.body)
    .catch(() => null);

  if (!existing) {
    console.log(`preUndeploy: Extension '${EXTENSION_KEY}' already absent — nothing to do.`);
    return;
  }
  await apiRoot.extensions().withKey({ key: EXTENSION_KEY })
    .delete({ queryArgs: { version: existing.version } }).execute();
  console.log(`preUndeploy: Extension '${EXTENSION_KEY}' removed.`);
}

run().catch((error: Error) => {
  process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
