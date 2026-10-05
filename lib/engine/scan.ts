import type { Dataset } from "@/types/domain";
import type { Finding, Health } from "@/types/insights";
import { computeHealth } from "@/lib/analytics/health";
import { METRICS, type DimKey, type MetricId, aggregate, dimsOf, hasMetric, periodsFor, valueOf, weeklySeries } from "@/lib/analytics/metrics";
import { detectFindings } from "@/lib/insights/findings";
import { formatEur, formatValue } from "@/lib/format";

/**
 * The business scan. Each stage runs a real analytical pass and reports what
 * it measured; the UI only paces and displays the results.
 */

export interface ScanStage {
  id: string;
  label: string;
  /** Dimension the visualization organises itself by during this stage. */
  dim: DimKey;
  run: (data: Dataset, ctx: ScanContext) => string[];
}

export interface ScanContext {
  findings?: Finding[];
  health?: Health;
}

const count = (n: number) => n.toLocaleString("en-GB");

function recentValue(data: Dataset, id: keyof typeof METRICS): number {
  const metric = METRICS[id];
  const { recent } = periodsFor(metric, data.weeks);
  return valueOf(metric, aggregate(weeklySeries(data, metric), recent), recent.to - recent.from);
}

/** A readout line for a metric, or nothing when the data cannot support it. */
const line = (data: Dataset, id: MetricId, text: (value: string) => string): string[] =>
  hasMetric(data, id) ? [text(formatValue(recentValue(data, id), METRICS[id].unit))] : [];

/** The dimension a stage organises the visualization by, falling back when the data lacks it. */
export const stageDim = (data: Dataset, stage: ScanStage): DimKey | null => {
  const dims = dimsOf(data, "orders");
  return dims.includes(stage.dim) ? stage.dim : (dims[0] ?? null);
};

export const SCAN_STAGES: ScanStage[] = [
  {
    id: "customers", label: "Customers", dim: "segment",
    run: (data) => {
      const active = new Set(data.orders.filter((o) => o.week >= data.weeks - 26).map((o) => o.customerId)).size;
      if (!hasMetric(data, "repurchase")) return ["customers are not identified in this data"];
      return [`${count(data.customers.length)} customers`, `${count(active)} active in 26 weeks`, ...line(data, "repurchase", (v) => `${v} repeat rate`)];
    },
  },
  {
    id: "orders", label: "Orders", dim: "channel",
    run: (data) => [`${count(data.orders.length)} orders`, `${data.weeks} weeks`, `${formatEur(recentValue(data, "aov"))} average order`],
  },
  {
    id: "products", label: "Products", dim: "category",
    run: (data) => {
      const categories = new Set(data.products.map((p) => p.category)).size;
      return [
        ...(dimsOf(data, "orders").includes("product") ? [`${count(data.products.length)} products`] : ["products are not identified in this data"]),
        ...(dimsOf(data, "orders").includes("category") ? [`${categories} categories`] : []),
        ...line(data, "returns", (v) => `${v} returned`),
      ];
    },
  },
  {
    id: "operations", label: "Operations", dim: "country",
    run: (data) => [
      ...(dimsOf(data, "orders").includes("country") ? [`${data.countries.length} countries`] : []),
      ...line(data, "delivery", (v) => `${v} average delivery`),
      ...line(data, "onTime", (v) => `${v} on time`),
      ...(hasMetric(data, "delivery") ? [] : ["no delivery data"]),
    ],
  },
  {
    id: "financials", label: "Financials", dim: "country",
    run: (data) => [
      `${formatEur(recentValue(data, "revenue"))} weekly revenue`,
      ...line(data, "margin", (v) => `${v} contribution margin`),
      ...line(data, "cac", (v) => `${v} acquisition cost`),
    ],
  },
  {
    id: "risk", label: "Risk", dim: "country",
    run: (data, ctx) => {
      ctx.findings = detectFindings(data);
      ctx.health = computeHealth(data, ctx.findings);
      const significant = ctx.findings.filter((f) => f.confidence >= 0.95).length;
      return [`${ctx.findings.length} signals`, `${significant} statistically significant`, `health ${ctx.health.score} / ${ctx.health.max}`];
    },
  },
];
