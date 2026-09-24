import { apiRoot } from './client.js';
import type { Thresholds } from './rules.js';

/**
 * Thresholds come from Session 7.2's feature-flag Custom Object so ops can change them with no deploy,
 * and fall back to the connector's own configuration when it is absent.
 *
 * Cached, because an API Extension's budget is 2 seconds and a network call per invocation would spend
 * it. A stale threshold for up to 60s is the right trade; a slow cart write is not.
 */
const TTL_MS = 60_000;
let cached: { at: number; value: Thresholds } | null = null;

export async function readThresholds(): Promise<Thresholds> {
  const fallback: Thresholds = {
    maxQuantityPerLine: Number(process.env.MAX_QUANTITY_PER_LINE ?? 10),
    whiteGloveThresholdCents: Number(process.env.WHITE_GLOVE_THRESHOLD_CENTS ?? 40000),
  };
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    const { body } = await apiRoot
      .customObjects().withContainerAndKey({ container: 'lhc-config', key: 'feature-flags' })
      .get().execute();
    const v = body.value as Record<string, unknown>;
    const value: Thresholds = {
      maxQuantityPerLine: Number(v.maxQuantityPerLine ?? fallback.maxQuantityPerLine),
      whiteGloveThresholdCents: Number(v.whiteGloveThresholdCents ?? fallback.whiteGloveThresholdCents),
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    cached = { at: Date.now(), value: fallback };   // fail open, on the connector's own defaults
    return fallback;
  }
}
