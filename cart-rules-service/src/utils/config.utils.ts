import { numberEnv, optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  scopes?: string[];
  /** Shared secret the platform presents on every Extension call (see connector/actions.ts). */
  extensionSecret: string;
  maxQuantityPerLine: number;
  whiteGloveThresholdCents: number;
  /** Seconds the feature-flag Custom Object is cached for. The Extension budget is 2s; do not spend it. */
  configCacheSeconds: number;
}

let cached: Configuration | undefined;

/** Reads and validates every value this application needs. Throws at startup if any is missing. */
export function readConfiguration(): Configuration {
  if (cached) return cached;
  const scope = process.env.CTP_SCOPE;
  cached = {
    projectKey: requireEnv('CTP_PROJECT_KEY'),
    clientId: requireEnv('CTP_CLIENT_ID'),
    clientSecret: requireEnv('CTP_CLIENT_SECRET'),
    apiUrl: requireEnv('CTP_API_URL'),
    authUrl: requireEnv('CTP_AUTH_URL'),
    ...(scope ? { scopes: scope.split(' ').filter(Boolean) } : {}),
    extensionSecret: requireEnv('EXTENSION_SECRET'),
    maxQuantityPerLine: numberEnv('MAX_QUANTITY_PER_LINE', 10),
    whiteGloveThresholdCents: numberEnv('WHITE_GLOVE_THRESHOLD_CENTS', 40000),
    configCacheSeconds: numberEnv('CONFIG_CACHE_SECONDS', 60),
  };
  return cached;
}

/** Test seam. */
export function resetConfiguration(): void {
  cached = undefined;
}

export const ENV_NAME = optionalEnv('NODE_ENV', 'production');
