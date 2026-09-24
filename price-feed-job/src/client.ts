import { ClientBuilder } from '@commercetools/ts-client';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';

/**
 * The commercetools client, built from the environment Connect injects at runtime.
 *
 * Locally these come from `.env`; once deployed they are the `standardConfiguration` and
 * `securedConfiguration` values entered at install time (Session 9.1) — the code cannot tell
 * the difference, which is the point.
 */
const region = required('CTP_REGION');

export const projectKey = required('CTP_PROJECT_KEY');

export const apiRoot = createApiBuilderFromCtpClient(
  new ClientBuilder()
    .withProjectKey(projectKey)
    .withClientCredentialsFlow({
      host: `https://auth.${region}.commercetools.com`,
      projectKey,
      credentials: {
        clientId: required('CTP_CLIENT_ID'),
        clientSecret: required('CTP_CLIENT_SECRET'),
      },
      scopes: process.env.CTP_SCOPE ? process.env.CTP_SCOPE.split(' ') : undefined,
    })
    .withHttpMiddleware({ host: `https://api.${region}.commercetools.com` })
    .build(),
).withProjectKey({ projectKey });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required configuration: ${key}`);
  return value;
}
