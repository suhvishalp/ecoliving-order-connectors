import 'dotenv/config';
import { apiRoot, projectKey } from './client.js';

/**
 * Session 8.5 — a Job application: a cron expression and a function. No HTTP surface, no caller.
 *
 * Nobody is watching this run, so LOGS ARE THE ONLY EVIDENCE it happened, and its default failure mode
 * is silence — which is why it exits non-zero on any failed row, so the deployment's logs show red.
 *
 * Reuses Session 7.8's contract exactly: the Import API upserts BY KEY (variant key = SKU, price key =
 * SKU-CUR[-CC]), accepts at most 20 resources per request, and answers with an acknowledgement rather
 * than a result — the ImportOperations carry the outcome.
 */
const MAX_ROWS_PER_REQUEST = 20;

interface FeedRow { sku: string; currencyCode: string; centAmount: number; country?: string }

async function run(): Promise<void> {
  const containerKey = process.env.IMPORT_CONTAINER_KEY ?? 'lhc-price-feed';
  const rows = await loadFeed();
  if (rows.length === 0) {
    console.log('price-feed-job: nothing to import.');
    return;
  }

  let submitted = 0;
  for (const batch of chunk(rows, MAX_ROWS_PER_REQUEST)) {
    await submitBatch(containerKey, batch);       // see README: the Import API has its own host
    submitted += batch.length;
  }
  console.log(`price-feed-job: submitted ${submitted} row(s) to '${containerKey}' in project ${projectKey}.`);

  // Submitting is not importing. Session 7.8's lesson, on a schedule: poll the ImportOperations.
  const failed = await reportOperations(containerKey);
  if (failed > 0) throw new Error(`${failed} row(s) failed to import — see the operation errors above.`);
}

/** Replace with the real ERP feed. The course ships a fixture so the job has something to do. */
async function loadFeed(): Promise<FeedRow[]> {
  return [{ sku: 'CARM-023', currencyCode: 'EUR', centAmount: 49900, country: 'DE' }];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function submitBatch(_containerKey: string, _rows: FeedRow[]): Promise<void> {
  // TODO (8.5): post a PriceImportRequest to the Import API host (import.{region}.commercetools.com)
  // using @commercetools/importapi-sdk — the same call the BFF's CtImportRepository makes in 7.8.
  throw new Error('submitBatch is not implemented yet — task 8.5.');
}

async function reportOperations(_containerKey: string): Promise<number> {
  // TODO (8.5): query the container's ImportOperations, log one line per row, return the failure count.
  return 0;
}

run().catch((error: Error) => {
  process.stderr.write(`price-feed-job failed: ${error.message}\n`);
  process.exitCode = 1;
});

// Keeps `apiRoot` referenced for the reads the full implementation makes.
void apiRoot;
