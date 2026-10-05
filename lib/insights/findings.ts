import type { Dataset } from "@/types/domain";
import type { Finding, FindingId, Tone } from "@/types/insights";
import { type Comparison, aggregatePairs, effectOf } from "@/lib/analytics/compare";
import { DIMS, METRICS, type DimKey, type Metric, type MetricId, type Scope, periodsFor, valueOf, weeklyByDim, weeklySeries } from "@/lib/analytics/metrics";
import { type Shift, detectOutliers, detectShift } from "@/lib/anomaly/detect";
import { investigate } from "@/lib/root-cause/investigate";

/**
 * The seven investigation leads. Each is produced by a detector that scans
 * the data — nothing here refers to the planted scenarios.
 */

export interface Candidate {
  scope: Scope;
  shift: Shift;
  /** Share of the metric's fact rows covered by the slice. */
  coverage: number;
  score: number;
}

/** A total-level shift is preferred as the starting point when it is itself significant. */
const ROOT_CONFIDENCE = 0.9;

/** Scans the total and every one-dimensional slice (optionally two-dimensional) for shifts. */
export function scanShifts(data: Dataset, metric: Metric, pairs: [DimKey, DimKey][] = []): Candidate[] {
  const periods = periodsFor(metric, data.weeks);
  const out: Candidate[] = [];
  const totalSeries = weeklySeries(data, metric);
  const totalRows = totalSeries.n.reduce((s, x) => s + x, 0);
  const push = (scope: Scope, series: ReturnType<typeof weeklySeries>) => {
    const shift = detectShift(metric, series, periods);
    if (!shift) return;
    const coverage = series.n.reduce((s, x) => s + x, 0) / totalRows;
    out.push({ scope, shift, coverage, score: shift.z * Math.sqrt(coverage) });
  };
  push({}, totalSeries);
  for (const dim of DIMS[metric.source]) {
    for (const [member, series] of weeklyByDim(data, metric, dim)) push({ [dim]: member }, series);
  }
  for (const [d1, d2] of pairs) {
    for (const member of weeklyByDim(data, metric, d1).keys()) {
      for (const [m2, series] of weeklyByDim(data, metric, d2, { [d1]: member })) push({ [d1]: member, [d2]: m2 }, series);
    }
  }
  return out;
}

/** Picks where an investigation starts: the total if significant, else the strongest slice. */
function pickRoot(candidates: Candidate[], direction: 1 | -1): Candidate | null {
  const total = candidates.find((c) => Object.keys(c.scope).length === 0);
  if (total && total.shift.z * direction > 0 && total.shift.confidence >= ROOT_CONFIDENCE) return total;
  const slices = candidates.filter((c) => c.score * direction > 0 && Object.keys(c.scope).length > 0);
  slices.sort((a, b) => b.score * direction - a.score * direction);
  return slices[0] ?? total ?? null;
}

function toneOf(metric: Metric, change: number, confidence: number): Tone {
  const good = change * metric.polarity > 0;
  if (good) return "positive";
  return confidence >= 0.95 ? "risk" : "attention";
}

function temporalFinding(
  data: Dataset, id: FindingId, title: string, metricId: MetricId, direction: 1 | -1, slicesOnly = false, pairs: [DimKey, DimKey][] = [],
): Omit<Finding, "index"> | null {
  const metric: Metric = METRICS[metricId];
  let candidates = scanShifts(data, metric, pairs);
  if (slicesOnly) candidates = candidates.filter((c) => Object.keys(c.scope).length > 0);
  const root = pickRoot(candidates, direction);
  if (!root) return null;
  const comparison: Comparison = { kind: "time", periods: periodsFor(metric, data.weeks) };
  const effect = effectOf(metric, aggregatePairs(data, metric, root.scope, comparison).total, comparison);
  return {
    id, title, metric: metricId, scope: root.scope, comparison, effect, expected: root.shift.expected,
    z: root.shift.z, confidence: root.shift.confidence, tone: toneOf(metric, effect.change, root.shift.confidence),
    investigation: investigate(data, metricId, root.scope, comparison),
  };
}

/** Cross-sectional outlier: the member of `dim` furthest below its peers on a ratio metric. */
function peerFinding(data: Dataset, id: FindingId, title: string, metricId: MetricId, dim: DimKey): Omit<Finding, "index"> | null {
  const metric: Metric = METRICS[metricId];
  const periods = periodsFor(metric, data.weeks);
  const window = { from: periods.baseline.from, to: periods.recent.to };
  const values = new Map<string, number>();
  for (const [member, s] of weeklyByDim(data, metric, dim)) {
    let num = 0;
    let den = 0;
    let n = 0;
    for (let w = window.from; w < window.to; w++) {
      num += s.num[w];
      den += s.den[w];
      n += s.n[w];
    }
    values.set(member, valueOf(metric, { num, den, n }, window.to - window.from));
  }
  const worst = detectOutliers(values).sort((a, b) => a.z * metric.polarity - b.z * metric.polarity)[0];
  if (!worst) return null;
  const scope: Scope = { [dim]: worst.member };
  const comparison: Comparison = { kind: "peers", periods, peerDim: dim };
  const effect = effectOf(metric, aggregatePairs(data, metric, scope, comparison).total, comparison);
  return {
    id, title, metric: metricId, scope, comparison, effect, expected: null,
    z: worst.z, confidence: worst.confidence, tone: toneOf(metric, effect.change, worst.confidence),
    investigation: investigate(data, metricId, scope, comparison),
  };
}

export function detectFindings(data: Dataset): Finding[] {
  const found = [
    temporalFinding(data, "revenue", "Revenue anomaly", "revenue", -1),
    temporalFinding(data, "churn", "Customer churn", "repurchase", -1, true),
    temporalFinding(data, "margin", "Margin compression", "margin", -1),
    temporalFinding(data, "delivery", "Delivery performance", "delivery", 1, true),
    peerFinding(data, "region", "Regional underperformance", "margin", "country"),
    temporalFinding(data, "marketing", "Marketing efficiency", "cac", 1),
    temporalFinding(data, "opportunity", "Product opportunity", "revenue", 1, true, [["country", "category"]]),
  ];
  return found.filter((f) => f !== null).map((f, i) => ({ ...f, index: i + 1 }));
}
