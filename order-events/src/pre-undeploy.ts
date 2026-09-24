import 'dotenv/config';
import { apiRoot } from './client.js';

/**
 * Session 9.2 — the marquee, and not housekeeping.
 *
 * A Subscription left behind after teardown survives its connector, so the platform keeps pushing into a queue nothing reads —
 * messages pile up for 7 days and the next cohort inherits a Subscription they did not make, with nothing to
 * connect it to. Undeploying cleanly is the difference between a demo and something you would run.
 *
 * Idempotent: deleting something already gone must not throw, or a half-failed teardown strands the rest.
 */
const SUBSCRIPTION_KEY = 'lhc-order-events';

async function run(): Promise<void> {
  const existing = await apiRoot.subscriptions().withKey({ key: SUBSCRIPTION_KEY }).get().execute()
    .then((r) => r.body)
    .catch(() => null);

  if (!existing) {
    console.log(`preUndeploy: Subscription '${SUBSCRIPTION_KEY}' already absent — nothing to do.`);
    return;
  }
  await apiRoot.subscriptions().withKey({ key: SUBSCRIPTION_KEY })
    .delete({ queryArgs: { version: existing.version } }).execute();
  console.log(`preUndeploy: Subscription '${SUBSCRIPTION_KEY}' removed.`);
}

run().catch((error: Error) => {
  process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
