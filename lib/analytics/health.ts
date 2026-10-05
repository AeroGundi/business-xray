import type { Dataset } from "@/types/domain";
import type { Finding, Health, HealthComponent, HealthPillar } from "@/types/insights";
import { aggregatePairs, effectOf } from "./compare";
import { METRICS, type Metric, type MetricId, dimsOf, hasMetric, periodsFor, weeklyByDim } from "./metrics";
import { clamp } from "./stats";

/**
 * Business health score: five pillars worth 20 points each. Every component
 * maps one observed value linearly onto its points between a documented
 * `floor` (0 points) and `target` (full points). The thresholds below are the
 * whole methodology — changing them is the only way to change the score.
 */

interface Spec {
  id: string;
  label: string;
  unit: HealthComponent["unit"];
  floor: number;
  target: number;
  max: number;
}

export const HEALTH_SPEC: Record<string, { label: string; components: Spec[] }> = {
  growth: {
    label: "Growth",
    components: [
      { id: "revenueGrowth", label: "Revenue vs previous period", unit: "pct", floor: -0.1, target: 0.1, max: 12 },
      { id: "acquisitionGrowth", label: "New customers vs previous period", unit: "pct", floor: -0.1, target: 0.1, max: 8 },
    ],
  },
  profitability: {
    label: "Profit",
    components: [
      { id: "margin", label: "Contribution margin", unit: "pct", floor: 0.2, target: 0.4, max: 14 },
      { id: "discount", label: "Discount depth", unit: "pct", floor: 0.15, target: 0.04, max: 6 },
    ],
  },
  customers: {
    label: "Customers",
    components: [
      { id: "repurchase", label: "Repeat purchase rate", unit: "pct", floor: 0.1, target: 0.25, max: 12 },
      { id: "returns", label: "Return rate", unit: "pct", floor: 0.12, target: 0.03, max: 8 },
    ],
  },
  operations: {
    label: "Operations",
    components: [
      { id: "onTime", label: "On-time delivery", unit: "pct", floor: 0.7, target: 0.95, max: 12 },
      { id: "shippingShare", label: "Shipping cost / revenue", unit: "pct", floor: 0.08, target: 0.03, max: 8 },
    ],
  },
  risk: {
    label: "Risk",
    components: [
      { id: "anomalies", label: "Significant adverse anomalies", unit: "count", floor: 5, target: 0, max: 12 },
      { id: "concentration", label: "Revenue concentration (HHI)", unit: "index", floor: 0.35, target: 0.12, max: 8 },
    ],
  },
};

/** Metrics (and dimensions) each component needs; a component the data cannot support is left out. */
const NEEDS: Record<string, MetricId[]> = {
  revenueGrowth: ["revenue"], acquisitionGrowth: ["acquisitions"], margin: ["margin"], discount: ["discount"], repurchase: ["repurchase"],
  returns: ["returns"], onTime: ["onTime"], shippingShare: ["shipping"], anomalies: [], concentration: [],
};

/** Findings at or above this confidence count against the risk pillar. */
export const RISK_CONFIDENCE = 0.95;

export function computeHealth(data: Dataset, findings: Finding[]): Health {
  const recent = (metric: Metric) => {
    const c = { kind: "time" as const, periods: periodsFor(metric, data.weeks) };
    const pair = aggregatePairs(data, metric, {}, c).total;
    return { effect: effectOf(metric, pair, c), pair };
  };

  const revenue = recent(METRICS.revenue);
  const shipping = recent(METRICS.shipping);
  const byCountry = weeklyByDim(data, METRICS.revenue, "country");
  const { recent: window } = periodsFor(METRICS.revenue, data.weeks);
  let hhi = 0;
  for (const s of byCountry.values()) {
    let v = 0;
    for (let w = window.from; w < window.to; w++) v += s.num[w];
    hhi += (v / revenue.pair.a.num) ** 2;
  }

  const values: Record<string, number> = {
    revenueGrowth: revenue.effect.changePct,
    acquisitionGrowth: recent(METRICS.acquisitions).effect.changePct,
    margin: recent(METRICS.margin).effect.after,
    discount: recent(METRICS.discount).effect.after,
    repurchase: recent(METRICS.repurchase).effect.after,
    returns: recent(METRICS.returns).effect.after,
    onTime: recent(METRICS.onTime).effect.after,
    shippingShare: shipping.pair.a.num / revenue.pair.a.num,
    anomalies: findings.filter((f) => f.tone === "risk" && f.confidence >= RISK_CONFIDENCE).length,
    concentration: hhi,
  };

  const usable = (id: string) => NEEDS[id].every((m) => hasMetric(data, m)) && (id !== "concentration" || dimsOf(data, "orders").includes("country"));
  const missing: string[] = [];

  const pillars: HealthPillar[] = Object.entries(HEALTH_SPEC).map(([id, spec]) => {
    for (const c of spec.components) if (!usable(c.id)) missing.push(c.label);
    const components = spec.components.filter((c) => usable(c.id)).map((c) => {
      const value = values[c.id];
      const points = c.max * clamp((value - c.floor) / (c.target - c.floor), 0, 1);
      return { ...c, value, points };
    });
    return {
      id, label: spec.label, components,
      points: components.reduce((s, c) => s + c.points, 0),
      max: components.reduce((s, c) => s + c.max, 0),
    };
  });

  // With every component present the maximum is 100; otherwise points are rescaled to the maximum that could be earned.
  const earned = pillars.reduce((s, p) => s + p.points, 0);
  const possible = pillars.reduce((s, p) => s + p.max, 0);
  return { score: possible > 0 ? Math.round((100 * earned) / possible) : 0, max: 100, pillars, missing };
}
