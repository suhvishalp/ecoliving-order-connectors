import type {
  ByProjectKeyRequestBuilder,
  Destination,
  MessageSubscription,
  SubscriptionUpdateAction,
} from '@commercetools/platform-sdk';
import { logger } from '../utils/logger.utils.js';
import { HANDLED_TYPES } from '../services/fulfilment.service.js';

export const SUBSCRIPTION_KEY = 'lhc-order-events';

/**
 * Build the destination from what Connect injected.
 *
 * Connect provisions the topic when an `event` application deploys and passes its coordinates in. The
 * broker follows the REGION — Pub/Sub on GCP, SNS on AWS — so assuming Pub/Sub means the same source
 * registers the wrong destination type on an AWS deployment and then silently delivers nothing. Branch,
 * and fail loudly on anything unrecognised rather than guessing.
 */
export function buildDestination(env: NodeJS.ProcessEnv = process.env): Destination {
  const type = env.CONNECT_SUBSCRIPTION_DESTINATION;

  if (type === 'SNS') {
    return {
      type: 'SNS',
      topicArn: required(env, 'CONNECT_AWS_TOPIC_ARN'),
      authenticationMode: 'IAM',
    };
  }
  // Absent means Pub/Sub, per the platform's own example.
  if (type === 'GoogleCloudPubSub' || type == null || type === '') {
    return {
      type: 'GoogleCloudPubSub',
      topic: required(env, 'CONNECT_GCP_TOPIC_NAME'),
      projectId: required(env, 'CONNECT_GCP_PROJECT_ID'),
    };
  }
  throw new Error(`Unknown subscription destination type: ${type}`);
}

/**
 * Register the Subscription IDEMPOTENTLY — get, then update. Never delete-then-recreate: between the
 * DELETE and the POST there is a window, on every redeploy, in which messages are produced and simply
 * never delivered to anyone. Nobody notices, which is what makes it dangerous.
 */
export async function ensureOrderEventsSubscription(
  apiRoot: ByProjectKeyRequestBuilder,
  destination: Destination
): Promise<void> {
  const messages: MessageSubscription[] = [{ resourceTypeId: 'order', types: [...HANDLED_TYPES] }];
  const existing = await findSubscription(apiRoot);

  if (!existing) {
    await apiRoot.subscriptions().post({ body: { key: SUBSCRIPTION_KEY, destination, messages } }).execute();
    logger.info('postDeploy: Subscription created', { key: SUBSCRIPTION_KEY, destination: destination.type });
    return;
  }

  const actions: SubscriptionUpdateAction[] = [
    { action: 'changeDestination', destination },
    { action: 'setMessages', messages },
  ];
  await apiRoot
    .subscriptions()
    .withKey({ key: SUBSCRIPTION_KEY })
    .post({ body: { version: existing.version, actions } })
    .execute();
  logger.info('postDeploy: Subscription updated in place — no gap window', {
    key: SUBSCRIPTION_KEY,
    destination: destination.type,
  });
}

export async function deleteOrderEventsSubscription(apiRoot: ByProjectKeyRequestBuilder): Promise<void> {
  const existing = await findSubscription(apiRoot);
  if (!existing) {
    logger.info('preUndeploy: Subscription already absent', { key: SUBSCRIPTION_KEY });
    return;
  }
  await apiRoot
    .subscriptions()
    .withKey({ key: SUBSCRIPTION_KEY })
    .delete({ queryArgs: { version: existing.version } })
    .execute();
  logger.info('preUndeploy: Subscription removed', { key: SUBSCRIPTION_KEY });
}

async function findSubscription(apiRoot: ByProjectKeyRequestBuilder) {
  const {
    body: { results },
  } = await apiRoot
    .subscriptions()
    .get({ queryArgs: { where: `key = "${SUBSCRIPTION_KEY}"`, limit: 1 } })
    .execute();
  return results[0];
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key} — Connect sets this for event applications.`);
  return value;
}
