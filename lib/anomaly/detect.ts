import { clamp, mad, median, normalCdf } from "@/lib/analytics/stats";
import { type Metric, type Periods, type WeeklySeries, aggregate, span, valueOf } from "@/lib/analytics/metrics";

/**
 * Anomaly detection.
 *
 * Temporal shifts: the change between the baseline and recent periods is
 * compared with an empirical null distribution — the same statistic computed
 * on every earlier placement of the two windows in the series' own history.
 * A robust z-score (median / MAD) keeps the null insensitive to earlier
 * one-off events, and automatically accounts for each series' trend and noise.
 *
 * Cross-sectional outliers: a member is compared with its peers using the
 * same robust z-score across members.
 */

export interface Shift {
  before: number;
  after: number;
  /** Relative change for sums, absolute change for ratios. */
  delta: number;
  /** Typical delta in the series' own history. */
  expected: number;
  z: number;
  confidence: number;
  /** Number of historical window placements in the null distribution. */
  samples: number;
}

const MIN_NULL_SAMPLES = 12;

function windowDelta(metric: Metric, series: WeeklySeries, p: Periods): { before: number; after: number; delta: number } | null {
  const b = aggregate(series, p.baseline);
  const a = aggregate(series, p.recent);
  if (metric.den ? b.den <= 0 || a.den <= 0 : b.num <= 0) return null;
  const before = valueOf(metric, b, span(p.baseline));
  const after = valueOf(metric, a, span(p.recent));
  return { before, after, delta: metric.den ? after - before : (after - before) / before };
}

export const confidenceOf = (z: number): number => clamp(2 * normalCdf(Math.abs(z)) - 1, 0, 0.99);

export function detectShift(metric: Metric, series: WeeklySeries, periods: Periods): Shift | null {
  const observed = windowDelta(metric, series, periods);
  if (!observed) return null;
  const nulls: number[] = [];
  for (let k = span(periods.recent); periods.baseline.from - k >= 0; k++) {
    const shifted = windowDelta(metric, series, {
      baseline: { from: periods.baseline.from - k, to: periods.baseline.to - k },
      recent: { from: periods.recent.from - k, to: periods.recent.to - k },
    });
    if (shifted) nulls.push(shifted.delta);
  }
  if (nulls.length < MIN_NULL_SAMPLES) return null;
  const expected = median(nulls);
  // Floor the scale so near-constant histories cannot produce infinite z-scores.
  const floor = metric.den ? 0.002 * Math.abs(observed.before) + 1e-9 : 0.01;
  const z = (observed.delta - expected) / Math.max(mad(nulls), floor);
  return { ...observed, expected, z, confidence: confidenceOf(z), samples: nulls.length };
}

export interface Outlier {
  member: string;
  value: number;
  peerMedian: number;
  z: number;
  confidence: number;
}

/** Robust z-score of every member against the cross-section of its peers. */
export function detectOutliers(values: Map<string, number>): Outlier[] {
  const xs = [...values.values()];
  if (xs.length < 5) return [];
  const m = median(xs);
  const scale = Math.max(mad(xs), 1e-9);
  return [...values].map(([member, value]) => {
    const z = (value - m) / scale;
    return { member, value, peerMedian: m, z, confidence: confidenceOf(z) };
  });
}
