import type { Dataset } from "@/types/domain";
import type { Finding, FindingId } from "@/types/insights";
import { aggregatePairs } from "@/lib/analytics/compare";
import { METRICS, type Metric, type MetricId, periodsFor } from "@/lib/analytics/metrics";
import { clamp } from "@/lib/analytics/stats";
import { type Estimate, estimateLatenessOnRepeat, estimateLatenessOnReturns, estimateSpendElasticity, lateness } from "./estimate";

/**
 * What-If model: comparative statics on the weekly run-rate.
 *
 * The business is summarised by its last 10 weeks (the baseline). Each lever
 * changes one driver through an explicit response function; the model
 * returns the weekly run-rate once the customer base has adjusted to the
 * change. It is not a forecast of the path there.
 *
 *   demand factor      Q  = (effective price ratio) ^ ε
 *   acquisitions       N  = N₀ · (1 + m)^η · Q
 *   repeat rate        r  = r₀ + β_late·Δlate(ΔD) + k·√(b / 1000)
 *   continuation       c  = c₀ · r / r₀            (c₀ = share of orders that are repeat orders)
 *   orders             O  = O₀ · (1 + m)^η · Q · (1 − c₀) / (1 − c)
 *   return rate        ρ  = ρ₀ + β_ret·Δlate(ΔD)
 *   revenue            = O · list₀ · (1 + p) · (1 − d)
 *   profit             = O · [(1 − ρ)(revenue/order − cogs − ship) − ρ(2·ship + ¼·cogs)] − spend − b
 *
 * Parameters marked "estimated" are fitted to the data (lib/simulation/estimate.ts);
 * those marked "assumed" cannot be identified from it and are stated openly.
 */

export interface Levers {
  /** List price change, fraction (0.05 = +5%). */
  price: number;
  /** Change in average discount depth, absolute (0.02 = +2 pts). */
  discount: number;
  /** Marketing spend change, fraction. */
  spend: number;
  /** Change in delivery time for every order, days. */
  delivery: number;
  /** Weekly retention programme budget, EUR. */
  retention: number;
  /** Share of one finding's estimated impact that is recovered (0..1). */
  resolve: number;
  resolveId: FindingId | null;
}

export const NO_CHANGE: Levers = { price: 0, discount: 0, spend: 0, delivery: 0, retention: 0, resolve: 0, resolveId: null };

export interface Baseline {
  weeks: number;
  orders: number;
  acquisitions: number;
  spend: number;
  listPerOrder: number;
  discount: number;
  cogsPerOrder: number;
  shippingPerOrder: number;
  returnRate: number;
  repeatRate: number;
  /** Share of orders placed by returning customers. */
  continuation: number;
  deliveryDays: number;
}

export interface Parameter {
  id: string;
  label: string;
  value: number;
  /** Standard error, for estimated parameters. */
  se?: number;
  n?: number;
  source: "estimated" | "assumed";
  note: string;
}

export interface Model {
  baseline: Baseline;
  params: Record<"priceElasticity" | "spendElasticity" | "lateOnRepeat" | "lateOnReturns" | "retentionResponse" | "expediteCost", Parameter>;
  /** Mean days late across recent orders if every delivery shifted by `days`. */
  latenessAt: (days: number) => number;
  /** Findings whose impact can be expressed as weekly revenue or profit. */
  resolvable: { id: FindingId; title: string; revenuePerWeek: number; profitPerWeek: number }[];
}

export interface Outcome {
  revenue: number;
  profit: number;
  acquisitions: number;
  orders: number;
  repeatRate: number;
  returnRate: number;
  margin: number;
  deliveryDays: number;
}

/** Price elasticities used for the sensitivity range (assumed parameter). */
export const PRICE_ELASTICITY = { central: -1.3, inelastic: -0.8, elastic: -1.8 };

const estimated = (id: string, label: string, e: Estimate, note: string): Parameter => ({ id, label, value: e.value, se: e.se, n: e.n, source: "estimated", note });
const assumed = (id: string, label: string, value: number, note: string): Parameter => ({ id, label, value, source: "assumed", note });

/** Metrics whose finding impact is revenue; the rest (margin, CAC) are pure profit effects. */
const REVENUE_IMPACT: MetricId[] = ["revenue", "repurchase"];

export function calibrate(data: Dataset, findings: Finding[]): Model {
  const recent = (id: MetricId) => {
    const metric: Metric = METRICS[id];
    return aggregatePairs(data, metric, {}, { kind: "time", periods: periodsFor(metric, data.weeks) }).total.a;
  };
  const { recent: window } = periodsFor(METRICS.revenue, data.weeks);
  const weeks = window.to - window.from;
  const rows = data.orders.filter((o) => o.week >= window.from && o.week < window.to);
  const sum = (f: (o: (typeof rows)[number]) => number) => rows.reduce((s, o) => s + f(o), 0);
  const n = rows.length;
  const repeat = recent("repurchase");
  const marketing = recent("cac");

  const baseline: Baseline = {
    weeks,
    orders: n / weeks,
    acquisitions: marketing.den / weeks,
    spend: marketing.num / weeks,
    listPerOrder: sum((o) => o.listAmount) / n,
    discount: sum((o) => o.discountAmount) / sum((o) => o.listAmount),
    cogsPerOrder: sum((o) => o.cogs) / n,
    shippingPerOrder: sum((o) => o.shipping) / n,
    returnRate: sum((o) => o.returned) / n,
    repeatRate: repeat.num / repeat.den,
    continuation: 1 - sum((o) => o.isFirst) / n,
    deliveryDays: sum((o) => o.deliveryDays) / n,
  };

  const gaps = Float64Array.from(rows, (o) => o.deliveryDays - o.promisedDays);
  const latenessAt = (days: number) => {
    let s = 0;
    for (let i = 0; i < gaps.length; i++) s += lateness(gaps[i] + days, 0);
    return s / gaps.length;
  };

  const margin = simulateWith(baseline, {
    priceElasticity: PRICE_ELASTICITY.central, spendElasticity: 0, lateOnRepeat: 0, lateOnReturns: 0, retentionResponse: 0, expediteCost: 0,
  }, latenessAt, [], NO_CHANGE).margin;

  return {
    baseline,
    latenessAt,
    params: {
      priceElasticity: assumed("priceElasticity", "Price elasticity of demand", PRICE_ELASTICITY.central,
        "List prices never change in the data, so this cannot be estimated. Results are also shown for −0.8 and −1.8."),
      spendElasticity: estimated("spendElasticity", "Acquisition elasticity to spend", estimateSpendElasticity(data),
        "log(new customers) on log(spend), paid channels, weekly, channel fixed effects."),
      lateOnRepeat: estimated("lateOnRepeat", "Repeat rate per day late", estimateLatenessOnRepeat(data),
        "Linear probability model on order level with segment fixed effects."),
      lateOnReturns: estimated("lateOnReturns", "Return rate per day late", estimateLatenessOnReturns(data),
        "Linear probability model on order level with category fixed effects."),
      retentionResponse: assumed("retentionResponse", "Repeat-rate gain per √(€1k/week) of retention budget", 0.003,
        "No retention programme exists in the data. Assumes diminishing returns: €4k/week buys +0.6 pt."),
      expediteCost: assumed("expediteCost", "Shipping cost per day saved, per order", 0.9,
        "Carrier pricing is not in the data. Slower delivery is assumed to save nothing."),
    },
    resolvable: findings
      .filter((f) => f.tone !== "positive" && f.investigation.impact.unit === "eur" && f.comparison.kind === "time")
      .map((f) => {
        const perWeek = -f.investigation.impact.value / f.investigation.impact.weeks;
        const isRevenue = REVENUE_IMPACT.includes(f.metric);
        // Recovered revenue is assumed to earn the business's average contribution margin.
        return { id: f.id, title: f.title, revenuePerWeek: isRevenue ? perWeek : 0, profitPerWeek: isRevenue ? perWeek * margin : perWeek };
      }),
  };
}

type Values = Record<keyof Model["params"], number>;

function simulateWith(b: Baseline, v: Values, latenessAt: Model["latenessAt"], resolvable: Model["resolvable"], l: Levers): Outcome {
  const discount = clamp(b.discount + l.discount, 0, 0.6);
  const priceRatio = ((1 + l.price) * (1 - discount)) / (1 - b.discount);
  const demand = Math.pow(priceRatio, v.priceElasticity);
  const reach = Math.pow(1 + l.spend, v.spendElasticity);

  const late = latenessAt(l.delivery) - latenessAt(0);
  const repeatRate = clamp(b.repeatRate + v.lateOnRepeat * late + v.retentionResponse * Math.sqrt(l.retention / 1000), 0.01, 0.9);
  const continuation = clamp(b.continuation * (repeatRate / b.repeatRate), 0, 0.95);
  const returnRate = clamp(b.returnRate + v.lateOnReturns * late, 0, 0.6);

  const orders = b.orders * reach * demand * ((1 - b.continuation) / (1 - continuation));
  const perOrder = b.listPerOrder * (1 + l.price) * (1 - discount);
  const shipping = b.shippingPerOrder + v.expediteCost * Math.max(0, -l.delivery);
  const unitProfit = (1 - returnRate) * (perOrder - b.cogsPerOrder - shipping) - returnRate * (2 * shipping + 0.25 * b.cogsPerOrder);

  const fix = resolvable.find((r) => r.id === l.resolveId);
  const recovered = fix ? fix.profitPerWeek * l.resolve : 0;
  const revenue = orders * perOrder + (fix ? fix.revenuePerWeek * l.resolve : 0);
  const profit = orders * unitProfit - b.spend * (1 + l.spend) - l.retention + recovered;
  return {
    revenue, profit, orders, repeatRate, returnRate,
    acquisitions: b.acquisitions * reach * demand,
    margin: (orders * unitProfit + recovered) / revenue,
    deliveryDays: b.deliveryDays + l.delivery,
  };
}

const valuesOf = (m: Model, priceElasticity = m.params.priceElasticity.value): Values => ({
  priceElasticity,
  spendElasticity: m.params.spendElasticity.value,
  lateOnRepeat: m.params.lateOnRepeat.value,
  lateOnReturns: m.params.lateOnReturns.value,
  retentionResponse: m.params.retentionResponse.value,
  expediteCost: m.params.expediteCost.value,
});

export function simulate(model: Model, levers: Levers, priceElasticity?: number): Outcome {
  return simulateWith(model.baseline, valuesOf(model, priceElasticity), model.latenessAt, model.resolvable, levers);
}

export interface Projection {
  current: Outcome;
  outcome: Outcome;
  /** Outcomes under the inelastic and elastic price assumptions. */
  range: { inelastic: Outcome; elastic: Outcome };
  /** True when the price assumption affects the result. */
  priceSensitive: boolean;
}

export function project(model: Model, levers: Levers): Projection {
  return {
    current: simulate(model, NO_CHANGE),
    outcome: simulate(model, levers),
    range: { inelastic: simulate(model, levers, PRICE_ELASTICITY.inelastic), elastic: simulate(model, levers, PRICE_ELASTICITY.elastic) },
    priceSensitive: levers.price !== 0 || levers.discount !== 0,
  };
}

export interface Scenario {
  id: string;
  name: string;
  levers: Levers;
}

export function presets(model: Model): Scenario[] {
  const worst = [...model.resolvable].sort((a, b) => b.profitPerWeek - a.profitPerWeek)[0];
  return [
    { id: "a", name: "Current strategy", levers: NO_CHANGE },
    { id: "b", name: "Increase prices", levers: { ...NO_CHANGE, price: 0.06 } },
    { id: "c", name: "Prices + retention", levers: { ...NO_CHANGE, price: 0.06, retention: 4000 } },
    { id: "d", name: "Faster delivery", levers: { ...NO_CHANGE, delivery: -1 } },
    ...(worst ? [{ id: "e", name: `Resolve ${worst.title.toLowerCase()}`, levers: { ...NO_CHANGE, resolve: 1, resolveId: worst.id } }] : []),
  ];
}

export const sameLevers = (a: Levers, b: Levers): boolean =>
  (Object.keys(a) as (keyof Levers)[]).every((k) => a[k] === b[k]) || (a.resolve === 0 && b.resolve === 0 && (Object.keys(a) as (keyof Levers)[]).every((k) => k === "resolveId" || a[k] === b[k]));
