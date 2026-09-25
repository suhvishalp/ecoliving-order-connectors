import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { deleteOrderEventsSubscription } from './actions.js';

/**
 * A Subscription left behind outlives its connector: the platform keeps pushing into a topic nothing
 * reads, messages accumulate for their 7-day retention, and the next person to look at the project
 * inherits a Subscription nobody made.
 */
async function run(): Promise<void> {
  await deleteOrderEventsSubscription(createApiRoot());
}

run().catch((error: Error) => {
  process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
