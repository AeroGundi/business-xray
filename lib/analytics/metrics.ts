import type { Dataset, MarketingRow, OrderRow } from "@/types/domain";

/**
 * Metric registry. Every metric is a ratio Σnum / Σden over fact rows, or a
 * plain weekly sum when `den` is omitted. Defining metrics this way lets
 * aggregation, anomaly detection and contribution analysis stay generic.
 */

export type DimKey = "country" | "category" | "product" | "segment" | "channel";
export type Scope = Partial<Record<DimKey, string>>;
export type Unit = "eur" | "pct" | "days" | "count";
export type SourceId = "orders" | "marketing";
export type FactRow = OrderRow | MarketingRow;

export interface Metric {
  id: string;
  label: string;
  /** Short noun used inside sentences. */
  noun: string;
  source: SourceId;
  unit: Unit;
  /** Whether an increase is good, bad, or context-dependent. */
  polarity: 1 | -1 | 0;
  num: (r: never) => number;
  den?: (r: never) => number;
  /** Weeks before the metric is fully observed (right-censoring). */
  lag?: number;
}

const order = (
  id: string, label: string, noun: string, unit: Unit, polarity: 1 | -1 | 0,
  num: (r: OrderRow) => number, den?: (r: OrderRow) => number, lag?: number,
): Metric => ({ id, label, noun, source: "orders", unit, polarity, num, den, lag });

const mkt = (
  id: string, label: string, noun: string, unit: Unit, polarity: 1 | -1 | 0,
  num: (r: MarketingRow) => number, den?: (r: MarketingRow) => number,
): Metric => ({ id, label, noun, source: "marketing", unit, polarity, num, den });

const one = () => 1;

export const METRICS = {
  revenue: order("revenue", "Revenue", "revenue", "eur", 1, (r) => r.revenue),
  orders: order("orders", "Orders", "order volume", "count", 1, one),
  margin: order("margin", "Contribution margin", "contribution margin", "pct", 1, (r) => r.profit, (r) => r.revenue),
  delivery: order("delivery", "Delivery time", "delivery time", "days", -1, (r) => r.deliveryDays, one),
  discount: order("discount", "Discount depth", "discount depth", "pct", 0, (r) => r.discountAmount, (r) => r.listAmount),
  returns: order("returns", "Return rate", "return rate", "pct", -1, (r) => r.returned, one),
  repurchase: order("repurchase", "Repeat purchase rate", "repeat purchase rate", "pct", 1, (r) => r.repurchased, (r) => r.eligible, 5),
  newShare: order("newShare", "New-customer share", "share of first-time orders", "pct", 0, (r) => r.isFirst, one),
  aov: order("aov", "Order value", "average order value", "eur", 1, (r) => r.revenue, one),
  onTime: order("onTime", "On-time delivery", "on-time delivery rate", "pct", 1, (r) => (r.deliveryDays <= r.promisedDays + 1 ? 1 : 0), one),
  shipping: order("shipping", "Shipping cost per order", "shipping cost per order", "eur", -1, (r) => r.shipping, one),
  cac: mkt("cac", "Acquisition cost", "customer acquisition cost", "eur", -1, (r) => r.spend, (r) => r.newCustomers),
  spend: mkt("spend", "Marketing spend", "marketing spend", "eur", 0, (r) => r.spend),
  acquisitions: mkt("acquisitions", "New customers", "new customers", "count", 1, (r) => r.newCustomers),
} as const satisfies Record<string, Metric>;

export type MetricId = keyof typeof METRICS;

export const DIMS: Record<SourceId, DimKey[]> = {
  orders: ["country", "category", "product", "segment", "channel"],
  marketing: ["country", "channel"],
};

export const DIM_LABEL: Record<DimKey, string> = {
  country: "Country", category: "Category", product: "Product", segment: "Customer segment", channel: "Channel",
};

export const rowsOf = (data: Dataset, source: SourceId): FactRow[] => (source === "orders" ? data.orders : data.marketing);

export function inScope(row: FactRow, scope: Scope): boolean {
  for (const k in scope) if ((row as unknown as Record<string, string>)[k] !== scope[k as DimKey]) return false;
  return true;
}

export const dimOf = (row: FactRow, dim: DimKey): string => (row as unknown as Record<string, string>)[dim];

/** Half-open week interval [from, to). */
export interface Window {
  from: number;
  to: number;
}

export interface Agg {
  num: number;
  den: number;
  /** Fact rows aggregated. */
  n: number;
}

export const emptyAgg = (): Agg => ({ num: 0, den: 0, n: 0 });

/** Metric value of an aggregate; sums are normalised to a weekly rate. */
export function valueOf(metric: Metric, agg: Agg, weeks: number): number {
  if (metric.den) return agg.den > 0 ? agg.num / agg.den : 0;
  return weeks > 0 ? agg.num / weeks : 0;
}

/** Weekly numerator / denominator arrays of a metric within a scope. */
export interface WeeklySeries {
  num: Float64Array;
  den: Float64Array;
  n: Float64Array;
}

const newSeries = (weeks: number): WeeklySeries => ({
  num: new Float64Array(weeks), den: new Float64Array(weeks), n: new Float64Array(weeks),
});

export function weeklySeries(data: Dataset, metric: Metric, scope: Scope = {}): WeeklySeries {
  const s = newSeries(data.weeks);
  const num = metric.num as (r: FactRow) => number;
  const den = metric.den as ((r: FactRow) => number) | undefined;
  for (const row of rowsOf(data, metric.source)) {
    if (!inScope(row, scope)) continue;
    s.num[row.week] += num(row);
    s.den[row.week] += den ? den(row) : 1;
    s.n[row.week]++;
  }
  return s;
}

/** Weekly series for every member of `dim` within a scope, in one pass. */
export function weeklyByDim(data: Dataset, metric: Metric, dim: DimKey, scope: Scope = {}): Map<string, WeeklySeries> {
  const out = new Map<string, WeeklySeries>();
  const num = metric.num as (r: FactRow) => number;
  const den = metric.den as ((r: FactRow) => number) | undefined;
  for (const row of rowsOf(data, metric.source)) {
    if (!inScope(row, scope)) continue;
    const key = dimOf(row, dim);
    let s = out.get(key);
    if (!s) out.set(key, (s = newSeries(data.weeks)));
    s.num[row.week] += num(row);
    s.den[row.week] += den ? den(row) : 1;
    s.n[row.week]++;
  }
  return out;
}

export function aggregate(series: WeeklySeries, w: Window): Agg {
  const a = emptyAgg();
  for (let i = Math.max(0, w.from); i < Math.min(series.num.length, w.to); i++) {
    a.num += series.num[i];
    a.den += series.den[i];
    a.n += series.n[i];
  }
  return a;
}

/** Per-week metric values (ratio, or weekly sum). */
export function weeklyValues(metric: Metric, series: WeeklySeries): number[] {
  return Array.from(series.num, (n, i) => (metric.den ? (series.den[i] > 0 ? n / series.den[i] : NaN) : n));
}

/** Analysis periods: the most recent weeks against the weeks just before. */
export interface Periods {
  baseline: Window;
  recent: Window;
}

export const WINDOW_WEEKS = 10;

/** Comparison periods for a metric, shortened where follow-up is censored. */
export function periodsFor(metric: Metric, weeks: number): Periods {
  const split = weeks - WINDOW_WEEKS;
  return { baseline: { from: split - WINDOW_WEEKS, to: split }, recent: { from: split, to: weeks - (metric.lag ?? 0) } };
}

export const span = (w: Window): number => w.to - w.from;
