import { numberEnv, optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  importUrl: string;
  scopes?: string[];
  importContainerKey: string;
  feedContainer: string;
  feedKey: string;
  /** A run that started less than this ago is assumed still alive; this one stands down. */
  lockStaleMinutes: number;
  /** How long to wait for every ImportOperation to settle before reporting what is still pending. */
  pollTimeoutSeconds: number;
  pollIntervalSeconds: number;
}

let cached: Configuration | undefined;

export function readConfiguration(): Configuration {
  if (cached) return cached;
  const apiUrl = requireEnv('CTP_API_URL');
  const scope = process.env.CTP_SCOPE;
  cached = {
    projectKey: requireEnv('CTP_PROJECT_KEY'),
    clientId: requireEnv('CTP_CLIENT_ID'),
    clientSecret: requireEnv('CTP_CLIENT_SECRET'),
    apiUrl,
    authUrl: requireEnv('CTP_AUTH_URL'),
    // The Import API is a separate service on its own host. Derive it from the API URL so one region
    // setting drives everything, but allow an override.
    importUrl: optionalEnv('CTP_IMPORT_URL', apiUrl.replace('://api.', '://import.')),
    ...(scope ? { scopes: scope.split(' ').filter(Boolean) } : {}),
    importContainerKey: optionalEnv('IMPORT_CONTAINER_KEY', 'lhc-price-feed'),
    feedContainer: optionalEnv('FEED_CONTAINER', 'lhc-price-feed'),
    feedKey: optionalEnv('FEED_KEY', 'pending'),
    lockStaleMinutes: numberEnv('LOCK_STALE_MINUTES', 45),
    pollTimeoutSeconds: numberEnv('POLL_TIMEOUT_SECONDS', 120),
    pollIntervalSeconds: numberEnv('POLL_INTERVAL_SECONDS', 5),
  };
  return cached;
}

export function resetConfiguration(): void {
  cached = undefined;
}
