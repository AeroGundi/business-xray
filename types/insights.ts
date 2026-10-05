import type { Comparison, Effect, Split } from "@/lib/analytics/compare";
import type { DimKey, MetricId, Scope } from "@/lib/analytics/metrics";

/** "ask" is an investigation opened from a natural-language question. */
export type FindingId = "revenue" | "churn" | "margin" | "delivery" | "region" | "marketing" | "opportunity" | "ask";
export type Tone = "risk" | "attention" | "positive";

/** One level of the root-cause drill-down. */
export interface DrillStep {
  dim: DimKey;
  member: string;
  /** Scope before and after narrowing to `member`. */
  parentScope: Scope;
  scope: Scope;
  effect: Effect;
  /** Share of the parent's change this member accounts for. */
  share: number;
  /** Member's share of the parent's reference volume. */
  weight: number;
  /** Full breakdown of the parent across this dimension. */
  split: Split;
}

/** A metric that moved together with the anomaly inside the final segment. */
export interface Driver {
  metric: MetricId;
  before: number;
  after: number;
  change: number;
  changePct: number;
  /** Change of the same metric outside the segment (control group). */
  controlChange: number | null;
  /** Difference-in-differences: change − controlChange. */
  did: number;
  /** Test statistic and two-sided p-value of segment after vs before. */
  statistic: number;
  p: number;
  /** Weekly correlation with the anomalous metric inside the segment. */
  correlation: { r: number; p: number; n: number } | null;
}

export interface Impact {
  /** Signed so that negative is harmful. */
  value: number;
  unit: "eur" | "count";
  label: string;
  /** Plain-language formula, shown as evidence. */
  basis: string;
  /** Projection to 52 weeks if the condition persists; null when not meaningful. */
  annualised: number | null;
  weeks: number;
}

export interface Investigation {
  steps: DrillStep[];
  leafScope: Scope;
  leafEffect: Effect;
  /** Share of the root change accounted for by the final segment. */
  shareOfRoot: number;
  drivers: Driver[];
  /** Weekly metric values at the root and in the final segment. */
  rootSeries: number[];
  leafSeries: number[];
  /** Weekly values of the leading driver in the final segment. */
  driverSeries: number[] | null;
  impact: Impact;
}

export interface Finding {
  id: FindingId;
  index: number;
  title: string;
  metric: MetricId;
  scope: Scope;
  comparison: Comparison;
  effect: Effect;
  /** Typical change expected from the series' own history. */
  expected: number | null;
  z: number;
  confidence: number;
  tone: Tone;
  investigation: Investigation;
  /** Set when the investigation answers a question: the question and how it was interpreted. */
  question?: string;
  interpretation?: string;
}

export interface HealthComponent {
  id: string;
  label: string;
  value: number;
  unit: "pct" | "count" | "index";
  /** Value mapped to 0 points and to full points. */
  floor: number;
  target: number;
  points: number;
  max: number;
}

export interface HealthPillar {
  id: string;
  label: string;
  points: number;
  max: number;
  components: HealthComponent[];
}

export interface Health {
  score: number;
  max: number;
  pillars: HealthPillar[];
}
