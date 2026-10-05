import type { Dataset } from "@/types/domain";
import type { DrillStep, Driver, Impact, Investigation } from "@/types/insights";
import { type Comparison, type Effect, type Pair, aggregatePairs, contributionOf, effectOf, sideOf, splitBy, weeksOf } from "@/lib/analytics/compare";
import { DIMS, METRICS, type FactRow, type Metric, type MetricId, type Scope, inScope, rowsOf, weeklySeries, weeklyValues } from "@/lib/analytics/metrics";
import { Accumulator, meanDifferenceTest, pearson } from "@/lib/analytics/stats";

/**
 * Root-cause exploration in two stages.
 *
 * 1. Drill-down ("where?"): at each level, every unused dimension is broken
 *    down by contribution analysis. The dimension whose leading member
 *    explains the most change *beyond its size* (share − weight, its
 *    "lift") is followed, provided the member is either concentrated or
 *    distinctly harder hit than its siblings (see DRILL). This is the explanatory-power / surprise idea of
 *    Adtributor (Bhagwan et al., NSDI 2014) in a simplified form.
 *
 * 2. Associated drivers ("why?"): inside the final segment, candidate
 *    operational metrics are tested for a shift (Welch t-test, or a
 *    two-proportion z-test for rates), contrasted
 *    with the rest of the business (difference-in-differences) and with the
 *    anomalous metric over time (Pearson correlation).
 *
 * The output is evidence of association. The data is observational, so no
 * step here establishes causation.
 */

export const DRILL = {
  maxDepth: 4,
  /** A member must be backed by this many fact rows. */
  minRows: 100,
  /** Concentration rule: explains ≥ minShare of the change and exceeds its volume share by ≥ minLift. */
  minShare: 0.35,
  minLift: 0.2,
  /** Distinctiveness rule: explains most of the change and moves ≥ ratio × as much as its siblings. */
  majorityShare: 0.5,
  distinctRatio: 2,
};

export const DRIVER = {
  maxP: 0.01,
  /** Minimum relative shift for a driver to be reported. */
  minRelChange: 0.05,
  maxDrivers: 4,
};

const CANDIDATES: Record<Metric["source"], MetricId[]> = {
  orders: ["delivery", "discount", "returns", "repurchase", "newShare", "aov", "shipping"],
  marketing: ["spend", "acquisitions"],
};

export function drill(data: Dataset, metric: Metric, rootScope: Scope, c: Comparison): DrillStep[] {
  const steps: DrillStep[] = [];
  let scope = { ...rootScope };
  while (steps.length < DRILL.maxDepth) {
    let best: DrillStep | null = null;
    let bestLift = -Infinity;
    for (const dim of DIMS[metric.source]) {
      if (dim in scope) continue;
      const split = splitBy(data, metric, scope, c, dim);
      if (split.total.change === 0) continue;
      const top = split.members.find((m) => m.n >= DRILL.minRows);
      // A dimension with a single dominant member adds no information (e.g. category once the product is fixed).
      if (!top || top.weight > 0.9) continue;
      const lift = Math.min(1, top.share) - top.weight;
      const concentrated = top.share >= DRILL.minShare && lift >= DRILL.minLift;
      const distinct = top.share >= DRILL.majorityShare &&
        (top.restChangePct * top.changePct <= 0 || Math.abs(top.changePct) >= DRILL.distinctRatio * Math.abs(top.restChangePct));
      if (!(concentrated || distinct) || lift <= bestLift) continue;
      bestLift = lift;
      best = {
        dim, member: top.member, parentScope: scope, scope: { ...scope, [dim]: top.member }, split,
        share: top.share, weight: top.weight,
        effect: { before: top.before, after: top.after, change: top.change, changePct: top.changePct, n: top.n },
      };
    }
    if (!best) break;
    steps.push(best);
    scope = best.scope;
  }
  return steps;
}

export function rowValue(metric: Metric, row: FactRow): number | null {
  const num = (metric.num as (r: FactRow) => number)(row);
  if (!metric.den) return num;
  const den = (metric.den as (r: FactRow) => number)(row);
  return den > 0 ? num / den : null;
}

/** Candidate driver metrics for a target, i.e. the hypotheses the engine can test. */
export function driverCandidates(target: Metric): MetricId[] {
  return CANDIDATES[target.source].filter((id) => id !== target.id);
}

/** A driver counts as supported when the shift is both significant and material. */
export const isSupported = (d: Driver): boolean => d.p <= DRIVER.maxP && Math.abs(d.changePct) >= DRIVER.minRelChange;

/** Tests candidate drivers inside a scope and returns every result, supported or not. */
export function testDrivers(data: Dataset, target: Metric, scope: Scope, c: Comparison, only?: MetricId[]): Driver[] {
  const candidates = only ?? driverCandidates(target);
  const hasControl = c.kind === "time" && Object.keys(scope).length > 0;
  const acc = candidates.map(() => ({ a: new Accumulator(), b: new Accumulator(), ca: new Accumulator(), cb: new Accumulator() }));

  for (const row of rowsOf(data, target.source)) {
    let side = sideOf(row, scope, c);
    let control = false;
    if (!side && hasControl && !inScope(row, scope)) {
      side = sideOf(row, {}, c);
      control = true;
    }
    if (!side) continue;
    for (let i = 0; i < candidates.length; i++) {
      const v = rowValue(METRICS[candidates[i]], row);
      if (v === null) continue;
      acc[i][control ? (side === "a" ? "ca" : "cb") : side].add(v);
    }
  }

  const targetWeekly = c.kind === "time" ? weeklyValues(target, weeklySeries(data, target, scope)) : null;
  return candidates.map((id, i) => {
    const { a, b, ca, cb } = acc[i];
    const test = meanDifferenceTest(a.moments, b.moments);
    const before = b.moments.mean;
    const controlChange = hasControl ? ca.moments.mean - cb.moments.mean : null;
    let correlation: Driver["correlation"] = null;
    if (targetWeekly) {
      const dv = weeklyValues(METRICS[id], weeklySeries(data, METRICS[id], scope));
      const xs: number[] = [];
      const ys: number[] = [];
      const last = data.weeks - Math.max(METRICS[id].lag ?? 0, target.lag ?? 0);
      for (let w = 0; w < last; w++) {
        if (Number.isFinite(dv[w]) && Number.isFinite(targetWeekly[w])) {
          xs.push(dv[w]);
          ys.push(targetWeekly[w]);
        }
      }
      correlation = pearson(xs, ys);
    }
    return {
      metric: id, before, after: a.moments.mean, change: test.diff, changePct: before !== 0 ? test.diff / Math.abs(before) : 0,
      controlChange, did: test.diff - (controlChange ?? 0), statistic: test.statistic, p: test.p, correlation,
    };
  });
}

export function findDrivers(data: Dataset, target: Metric, scope: Scope, c: Comparison): Driver[] {
  return testDrivers(data, target, scope, c)
    .filter(isSupported)
    .sort((x, y) => Math.abs(y.statistic) - Math.abs(x.statistic))
    .slice(0, DRIVER.maxDrivers);
}

/** Translates a metric change into a business quantity. Formulas are documented in docs/METHODOLOGY.md. */
export function estimateImpact(data: Dataset, metric: Metric, scope: Scope, c: Comparison, effect: Effect, pair: Pair): Impact {
  const weeks = weeksOf(c).a;
  const period = c.kind === "time" ? `${weeks} weeks` : `${weeks} weeks vs peers`;
  const eur = (value: number, label: string, basis: string): Impact => ({
    value: value * (metric.polarity || 1), unit: "eur", label, basis, annualised: (value * (metric.polarity || 1) * 52) / weeks, weeks,
  });
  switch (metric.id) {
    case "revenue":
      return eur(effect.change * weeks, "Revenue", `(recent − baseline weekly revenue) × ${period}`);
    case "margin":
      return eur(effect.change * pair.a.den, "Contribution profit", `margin change × revenue over ${period}`);
    case "cac":
      return eur(effect.change * pair.a.den, "Acquisition spend", `CAC change × customers acquired over ${period}`);
    case "repurchase": {
      const orders = aggregatePairs(data, METRICS.aov, scope, c).total.a;
      const aov = orders.den > 0 ? orders.num / orders.den : 0;
      const scale = weeks / Math.max(1, weeks - (metric.lag ?? 0));
      return eur(effect.change * pair.a.den * scale * aov, "Repeat revenue", `repeat-rate change × orders × average order value, ${period}`);
    }
    default:
      return {
        value: -pair.a.n, unit: "count", label: "Orders affected",
        basis: `orders in the segment over ${period}`, annualised: null, weeks,
      };
  }
}

export function investigate(data: Dataset, metricId: MetricId, rootScope: Scope, c: Comparison): Investigation {
  const metric: Metric = METRICS[metricId];
  const steps = drill(data, metric, rootScope, c);
  const leafScope = steps.length ? steps[steps.length - 1].scope : rootScope;

  const root = aggregatePairs(data, metric, rootScope, c).total;
  const leaf = aggregatePairs(data, metric, leafScope, c).total;
  const rootEffect = effectOf(metric, root, c);
  const leafEffect = effectOf(metric, leaf, c);
  // In peer comparisons the reference set is shared, so a sub-segment's share is measured against the focus side only.
  const shareOfRoot = !steps.length || rootEffect.change === 0 ? 1
    : c.kind === "time" ? contributionOf(metric, leaf, root, c) / rootEffect.change
    : steps.reduce((s, st) => s * Math.min(1, st.share), 1);

  const drivers = findDrivers(data, metric, leafScope, c);
  const lead = drivers[0];
  return {
    steps, leafScope, leafEffect, shareOfRoot, drivers,
    rootSeries: weeklyValues(metric, weeklySeries(data, metric, rootScope)),
    leafSeries: weeklyValues(metric, weeklySeries(data, metric, leafScope)),
    driverSeries: lead ? weeklyValues(METRICS[lead.metric], weeklySeries(data, METRICS[lead.metric], leafScope)) : null,
    impact: estimateImpact(data, metric, leafScope, c, leafEffect, leaf),
  };
}
