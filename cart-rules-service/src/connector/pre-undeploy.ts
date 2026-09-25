import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { deleteCartRulesExtension } from './actions.js';

/**
 * Runs before teardown. An Extension left behind points at a deployment that no longer answers, and
 * then EVERY cart write in the project fails on a 2-second timeout — for whoever inherits the project,
 * with nothing to connect it to. This is the difference between a demo and something you would run.
 */
async function run(): Promise<void> {
  await deleteCartRulesExtension(createApiRoot());
}

run().catch((error: Error) => {
  process.stderr.write(`Pre-undeploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
