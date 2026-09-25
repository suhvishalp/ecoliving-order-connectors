import { createApiRoot } from '../client/create.client.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';
import type { Thresholds } from './cart-rules.service.js';

/**
 * Thresholds come from Session 7.2's feature-flag Custom Object, so ops can change a rule without a
 * deploy — and are CACHED, because an API Extension's budget is 2 seconds and a network round trip per
 * cart write would spend a meaningful slice of it on data that changes twice a year.
 *
 * FAIL-OPEN, deliberately: if the Custom Object cannot be read we fall back to the connector's own
 * configured defaults rather than failing the cart write. Losing a threshold refresh is a small harm;
 * blocking every cart in the project because a config read blipped is a large one. The README states
 * this stance, and Session 9.4 asks whether it is the right one for each rule.
 */
export const CONFIG_CONTAINER = 'lhc-config';
export const CONFIG_KEY = 'feature-flags';

interface CacheEntry {
  value: Thresholds;
  expiresAt: number;
}
let cache: CacheEntry | undefined;

export async function readThresholds(): Promise<Thresholds> {
  const cfg = readConfiguration();
  const fallback: Thresholds = {
    maxQuantityPerLine: cfg.maxQuantityPerLine,
    whiteGloveThresholdCents: cfg.whiteGloveThresholdCents,
  };

  if (cache && Date.now() < cache.expiresAt) return cache.value;

  try {
    const { body } = await createApiRoot()
      .customObjects()
      .withContainerAndKey({ container: CONFIG_CONTAINER, key: CONFIG_KEY })
      .get()
      .execute();
    const raw = (body.value ?? {}) as Record<string, unknown>;
    const value: Thresholds = {
      maxQuantityPerLine: asNumber(raw.maxQuantityPerLine, fallback.maxQuantityPerLine),
      whiteGloveThresholdCents: asNumber(raw.whiteGloveThresholdCents, fallback.whiteGloveThresholdCents),
    };
    cache = { value, expiresAt: Date.now() + cfg.configCacheSeconds * 1000 };
    return value;
  } catch (error) {
    logger.warn('Falling back to configured thresholds; the feature-flag Custom Object was unreadable', {
      reason: (error as Error).message,
    });
    cache = { value: fallback, expiresAt: Date.now() + cfg.configCacheSeconds * 1000 };
    return fallback;
  }
}

export function resetThresholdCache(): void {
  cache = undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
