import type { Sample } from "./types.js";

/**
 * Chest-strap dropouts.
 *
 * The console records whatever the strap reports, including nothing. Dropouts show
 * up as implausibly low values (0, 14, 15, 30, 43...) sitting between physiologically
 * normal neighbours. Two independent signals catch them:
 *
 *  - an absolute floor: a working strap on someone mid-cardio does not read 15 bpm;
 *  - a rate-of-change limit: heart rate cannot fall 90 bpm in ten seconds.
 *
 * The rate check compares against the last *accepted* value, so a run of consecutive
 * bad samples cannot drag the reference down with it.
 */
export interface HeartRateQualityOptions {
  /** Values at or below this are dropouts regardless of context. Default 60. */
  floorBpm?: number;
  /** Largest plausible change from the last good sample. Default 25 bpm per 10s. */
  maxDeltaBpm?: number;
}

const DEFAULTS = { floorBpm: 60, maxDeltaBpm: 25 } as const;

/** Per-sample validity mask, parallel to `samples`. */
export function flagHeartRateDropouts(
  samples: readonly Sample[],
  options: HeartRateQualityOptions = {},
): boolean[] {
  const floor = options.floorBpm ?? DEFAULTS.floorBpm;
  const maxDelta = options.maxDeltaBpm ?? DEFAULTS.maxDeltaBpm;

  const valid: boolean[] = [];
  let reference: number | null = null;

  for (const sample of samples) {
    const bpm = sample.heartRateBpm;
    let ok = bpm > floor;
    if (ok && reference !== null && Math.abs(bpm - reference) > maxDelta) ok = false;
    valid.push(ok);
    if (ok) reference = bpm;
  }
  return valid;
}

export interface HeartRateStats {
  minBpm: number | null;
  maxBpm: number | null;
  meanBpm: number | null;
  /** Count of samples accepted as real. */
  validCount: number;
  /** Count of samples rejected as dropouts. */
  dropoutCount: number;
}

/** Summary over the samples that survive dropout filtering. */
export function heartRateStats(
  samples: readonly Sample[],
  options: HeartRateQualityOptions = {},
): HeartRateStats {
  const valid = flagHeartRateDropouts(samples, options);
  const good = samples.filter((_, i) => valid[i]).map((s) => s.heartRateBpm);
  const dropoutCount = samples.length - good.length;
  if (good.length === 0) {
    return { minBpm: null, maxBpm: null, meanBpm: null, validCount: 0, dropoutCount };
  }
  const sum = good.reduce((a, b) => a + b, 0);
  return {
    minBpm: Math.min(...good),
    maxBpm: Math.max(...good),
    meanBpm: sum / good.length,
    validCount: good.length,
    dropoutCount,
  };
}
