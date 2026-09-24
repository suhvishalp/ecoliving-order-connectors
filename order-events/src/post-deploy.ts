import 'dotenv/config';
import { apiRoot } from './client.js';

/**
 * Session 8.3 — the Subscription that Session 7 could not create.
 *
 * Connect provisions the topic when the event application deploys and hands its coordinates to this
 * script. Everything Session 7.5 taught as a concept — MessageSubscription, resourceTypeId, types,
 * at-least-once, no ordering — is now the code below. The concept-only session paid off here.
 */
const SUBSCRIPTION_KEY = 'lhc-order-events';

async function run(): Promise<void> {
  const destination = process.env.CONNECT_SUBSCRIPTION_DESTINATION;   // 'GoogleCloudPubSub' | 'SNS'

  const existing = await apiRoot.subscriptions().withKey({ key: SUBSCRIPTION_KEY }).get().execute()
    .then((r) => r.body)
    .catch(() => null);
  if (existing) {
    await apiRoot.subscriptions().withKey({ key: SUBSCRIPTION_KEY })
      .delete({ queryArgs: { version: existing.version } }).execute();
  }

  const dest =
    destination === 'SNS'
      ? { type: 'SNS' as const, topicArn: req('CONNECT_AWS_TOPIC_ARN'), authenticationMode: 'IAM' as const }
      : { type: 'GoogleCloudPubSub' as const,
          topic: req('CONNECT_GCP_TOPIC_NAME'),
          projectId: req('CONNECT_GCP_PROJECT_ID') };

  await apiRoot.subscriptions().post({
    body: {
      key: SUBSCRIPTION_KEY,
      destination: dest,
      messages: [{ resourceTypeId: 'order', types: ['OrderPaymentStateChanged', 'OrderCreated'] }],
    },
  }).execute();

  console.log(`postDeploy: Subscription '${SUBSCRIPTION_KEY}' -> ${dest.type}`);
}

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key} — Connect sets this for event applications.`);
  return v;
}

run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
