import type { ByProjectKeyRequestBuilder, ExtensionDraft, ExtensionUpdateAction } from '@commercetools/platform-sdk';
import { logger } from '../utils/logger.utils.js';

export const EXTENSION_KEY = 'lhc-cart-rules';
export const TYPE_KEY = 'order-extras';
export const WHITE_GLOVE_FIELD = 'requiresWhiteGlove';

/**
 * The Custom Type the rule writes to must exist BEFORE the Extension is registered. Without it every cart write that
 * crosses the white-glove threshold fails ("The extension returned update actions that could not be executed") — for
 * every client in the project, long after a green deploy. So postDeploy refuses: a red deploy is the cheap failure.
 * The Type is seeded in Session 7 (Postman seeder, "Session 7 — Extensibility").
 */
export async function assertWhiteGloveType(apiRoot: ByProjectKeyRequestBuilder): Promise<void> {
  let fields: string[];
  try {
    const { body } = await apiRoot.types().withKey({ key: TYPE_KEY }).get().execute();
    fields = body.fieldDefinitions.map((f) => f.name);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      throw new Error(
        `Custom Type '${TYPE_KEY}' does not exist in this project — run the seeder's "Session 7 — Extensibility" folder, ` +
          'then redeploy. Registering the Extension without it would fail every cart write over the white-glove threshold.'
      );
    }
    throw error;
  }
  if (!fields.includes(WHITE_GLOVE_FIELD)) {
    throw new Error(`Custom Type '${TYPE_KEY}' has no '${WHITE_GLOVE_FIELD}' field — add it (Boolean), then redeploy.`);
  }
}

/**
 * Register the API Extension IDEMPOTENTLY — get, then update; never delete-then-recreate.
 *
 * Delete-then-recreate is the pattern you will see in older connectors (including the previous LHC
 * training connector), and it is wrong for one specific reason: between the DELETE and the POST there
 * is a window, on EVERY redeploy, in which no Extension exists. Cart writes in that window skip the
 * rules silently. Nobody notices, which is what makes it dangerous.
 */
export async function ensureCartRulesExtension(
  apiRoot: ByProjectKeyRequestBuilder,
  serviceUrl: string,
  sharedSecret: string
): Promise<void> {
  const draft: ExtensionDraft = {
    key: EXTENSION_KEY,
    destination: {
      type: 'HTTP',
      url: serviceUrl,
      // NOTE the discriminator: `AuthorizationHeader`, NOT the schema's type name
      // `AuthorizationHeaderAuthentication` — that is rejected with InvalidJsonInput, and because a
      // failing postDeploy does not reliably fail the deployment, the Extension would simply never
      // register and every cart would quietly go unvalidated.
      authentication: { type: 'AuthorizationHeader', headerValue: `Bearer ${sharedSecret}` },
    },
    triggers: [{ resourceTypeId: 'cart', actions: ['Create', 'Update'] }],
    // The platform's default is 2000ms and the self-service maximum is 10000ms. We want to fail fast:
    // a slow Extension makes every cart write slow.
    timeoutInMs: 2000,
  };

  const existing = await findExtension(apiRoot);

  if (!existing) {
    await apiRoot.extensions().post({ body: draft }).execute();
    logger.info('postDeploy: Extension created', { key: EXTENSION_KEY, url: serviceUrl });
    return;
  }

  const actions: ExtensionUpdateAction[] = [
    { action: 'changeDestination', destination: draft.destination },
    { action: 'changeTriggers', triggers: draft.triggers },
    { action: 'setTimeoutInMs', timeoutInMs: draft.timeoutInMs! },
  ];
  await apiRoot
    .extensions()
    .withKey({ key: EXTENSION_KEY })
    .post({ body: { version: existing.version, actions } })
    .execute();
  logger.info('postDeploy: Extension updated in place — no gap window', { key: EXTENSION_KEY, url: serviceUrl });
}

/** Remove it. Absent is success: a teardown that throws on "already gone" strands whatever follows it. */
export async function deleteCartRulesExtension(apiRoot: ByProjectKeyRequestBuilder): Promise<void> {
  const existing = await findExtension(apiRoot);
  if (!existing) {
    logger.info('preUndeploy: Extension already absent', { key: EXTENSION_KEY });
    return;
  }
  await apiRoot
    .extensions()
    .withKey({ key: EXTENSION_KEY })
    .delete({ queryArgs: { version: existing.version } })
    .execute();
  logger.info('preUndeploy: Extension removed', { key: EXTENSION_KEY });
}

async function findExtension(apiRoot: ByProjectKeyRequestBuilder) {
  const {
    body: { results },
  } = await apiRoot
    .extensions()
    .get({ queryArgs: { where: `key = "${EXTENSION_KEY}"`, limit: 1 } })
    .execute();
  return results[0];
}
