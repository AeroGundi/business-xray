import type { Dataset } from "@/types/domain";
import type { Finding, Health } from "@/types/insights";
import { computeHealth } from "@/lib/analytics/health";
import { METRICS, type DimKey, aggregate, periodsFor, valueOf, weeklySeries } from "@/lib/analytics/metrics";
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

export const SCAN_STAGES: ScanStage[] = [
  {
    id: "customers", label: "Customers", dim: "segment",
    run: (data) => {
      const active = new Set(data.orders.filter((o) => o.week >= data.weeks - 26).map((o) => o.customerId)).size;
      return [`${count(data.customers.length)} customers`, `${count(active)} active in 26 weeks`, `${formatValue(recentValue(data, "repurchase"), "pct")} repeat rate`];
    },
  },
  {
    id: "orders", label: "Orders", dim: "channel",
    run: (data) => [`${count(data.orders.length)} orders`, `${data.weeks} weeks`, `${formatEur(recentValue(data, "aov"))} average order`],
  },
  {
    id: "products", label: "Products", dim: "category",
    run: (data) => [`${data.products.length} products`, `${new Set(data.products.map((p) => p.category)).size} categories`, `${formatValue(recentValue(data, "returns"), "pct")} returned`],
  },
  {
    id: "operations", label: "Operations", dim: "country",
    run: (data) => [`${data.countries.length} countries`, `${formatValue(recentValue(data, "delivery"), "days")} average delivery`, `${formatValue(recentValue(data, "onTime"), "pct")} on time`],
  },
  {
    id: "financials", label: "Financials", dim: "country",
    run: (data) => [`${formatEur(recentValue(data, "revenue"))} weekly revenue`, `${formatValue(recentValue(data, "margin"), "pct")} contribution margin`, `${formatEur(recentValue(data, "cac"))} acquisition cost`],
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
