import { numberEnv, optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  scopes?: string[];
  /** State key an order moves to once its payment succeeds. */
  targetStateKey: string;
  /** Order state to set alongside the custom state transition. */
  confirmOrderState: boolean;
  /** Guard: refuse to act on a message older than this, so a 7-day backlog cannot stampede. */
  maxMessageAgeHours: number;
}

let cached: Configuration | undefined;

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
    targetStateKey: optionalEnv('TARGET_STATE_KEY', 'order-picked'),
    confirmOrderState: optionalEnv('CONFIRM_ORDER_STATE', 'true') === 'true',
    maxMessageAgeHours: numberEnv('MAX_MESSAGE_AGE_HOURS', 72),
  };
  return cached;
}

export function resetConfiguration(): void {
  cached = undefined;
}
