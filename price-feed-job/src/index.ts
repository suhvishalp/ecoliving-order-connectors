import 'dotenv/config';
import { createApiRoot } from './client/create.client.js';
import { createImportApiRoot } from './client/create.import.client.js';
import { CustomObjectFeedSource } from './services/feed.service.js';
import { acquireLock } from './services/lock.service.js';
import { importPrices, resolveKeys } from './services/price-import.service.js';
import { readConfiguration } from './utils/config.utils.js';
import { logger } from './utils/logger.utils.js';

/**
 * The nightly price feed (course Session 8.5).
 *
 * A Job application has no HTTP surface and no caller. Nobody is watching it, so LOGS ARE THE ONLY
 * EVIDENCE it ran — and its natural failure mode is silence. This one therefore reports every row and
 * exits NON-ZERO when any row failed, so a bad night shows up red in the deployment log instead of
 * looking exactly like a good one.
 */
async function run(): Promise<number> {
  const started = Date.now();
  const config = readConfiguration();
  const apiRoot = createApiRoot();

  const lock = await acquireLock(apiRoot, config.feedContainer, config.lockStaleMinutes);
  if (!lock) {
    // Not a failure: the previous run is still going. Exit 0 — a red deployment log should mean
    // something is wrong, not that the schedule is tighter than the work.
    logger.info('Skipped: another run is in progress');
    return 0;
  }

  try {
    const rows = await new CustomObjectFeedSource(apiRoot, config.feedContainer, config.feedKey).read();
    if (rows.length === 0) {
      logger.info('Nothing to import', { durationMs: Date.now() - started });
      return 0;
    }

    const keys = await resolveKeys(apiRoot, [...new Set(rows.map((r) => r.sku))]);
    const result = await importPrices(createImportApiRoot(), config.importContainerKey, rows, keys, {
      timeoutSeconds: config.pollTimeoutSeconds,
      intervalSeconds: config.pollIntervalSeconds,
    });

    for (const row of result.rows) {
      const context = { sku: row.sku, priceKey: row.priceKey, state: row.state, errors: row.errors };
      if (row.errors.length > 0) logger.error('Row failed', context);
      else logger.info('Row settled', context);
    }
    logger.info('Price feed finished', {
      containerKey: result.containerKey,
      total: result.total,
      imported: result.imported,
      failed: result.failed,
      pending: result.pending,
      durationMs: Date.now() - started,
    });

    return result.failed > 0 ? 1 : 0;
  } finally {
    await lock.release();
  }
}

/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: Error) => {
      logger.error('Price feed failed', { reason: error.message, stack: error.stack });
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
export default run;
