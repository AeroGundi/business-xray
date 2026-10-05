import { describe, expect, it } from "vitest";
import { generateDataset } from "@/lib/data/generate";
import { SCENARIOS } from "@/lib/data/catalog";
import { METRICS, periodsFor, weeklySeries } from "@/lib/analytics/metrics";
import { aggregatePairs, splitBy, type Comparison } from "@/lib/analytics/compare";
import { meanDifferenceTest, mad, median, normalCdf, pearson } from "@/lib/analytics/stats";
import { detectShift } from "@/lib/anomaly/detect";
import { computeHealth } from "@/lib/analytics/health";
import { detectFindings } from "@/lib/insights/findings";

const data = generateDataset();
const findings = detectFindings(data);
const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

describe("statistics", () => {
  it("computes robust location and scale", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(mad([1, 2, 3, 4, 100])).toBeCloseTo(1.4826, 4);
  });
  it("approximates the normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("uses a pooled proportion test for binary outcomes", () => {
    const zero = { n: 12, mean: 0, variance: 0, binary: true };
    const some = { n: 100, mean: 0.09, variance: 0.0828, binary: true };
    expect(meanDifferenceTest(zero, some).p).toBeGreaterThan(0.2);
  });
  it("recovers a perfect correlation", () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]).r).toBeGreaterThan(0.999);
  });
});

describe("dataset", () => {
  it("is deterministic for a seed", () => {
    const again = generateDataset();
    expect(again.orders.length).toBe(data.orders.length);
    expect(again.orders[1234]).toEqual(data.orders[1234]);
  });
  it("is internally consistent", () => {
    for (const o of data.orders.slice(0, 5000)) {
      expect(o.revenue).toBeCloseTo(o.listAmount - o.discountAmount, 6);
      expect(o.deliveryDays).toBeGreaterThan(0);
      if (o.repurchased) expect(o.eligible).toBe(1);
    }
  });
});

describe("contribution analysis", () => {
  const c: Comparison = { kind: "time", periods: periodsFor(METRICS.revenue, data.weeks) };
  it("is exactly additive for a sum metric", () => {
    const split = splitBy(data, METRICS.revenue, {}, c, "country");
    const total = split.members.reduce((s, m) => s + m.contribution, 0);
    expect(total).toBeCloseTo(split.total.change, 6);
  });
  it("is exactly additive for a ratio metric", () => {
    const split = splitBy(data, METRICS.margin, {}, c, "channel");
    const total = split.members.reduce((s, m) => s + m.contribution, 0);
    expect(total).toBeCloseTo(split.total.change, 10);
  });
  it("matches direct aggregation", () => {
    const { total } = aggregatePairs(data, METRICS.orders, {}, c);
    const inWindow = data.orders.filter((o) => o.week >= c.periods.recent.from && o.week < c.periods.recent.to).length;
    expect(total.a.n).toBe(inWindow);
  });
});

describe("anomaly detection", () => {
  it("does not flag a stable series", () => {
    const series = { num: new Float64Array(78).fill(100), den: new Float64Array(78).fill(1), n: new Float64Array(78).fill(1) };
    expect(Math.abs(detectShift(METRICS.revenue, series, periodsFor(METRICS.revenue, 78))!.z)).toBeLessThan(0.5);
  });
  it("flags a step change", () => {
    const num = Float64Array.from({ length: 78 }, (_, i) => (i >= 68 ? 70 : 100) + (i % 3));
    const series = { num, den: new Float64Array(78).fill(1), n: new Float64Array(78).fill(1) };
    expect(detectShift(METRICS.revenue, series, periodsFor(METRICS.revenue, 78))!.z).toBeLessThan(-5);
  });
  it("sees the planted delivery disruption", () => {
    const scope = { country: "Germany", product: "Atlas Standing Desk" };
    const shift = detectShift(METRICS.delivery, weeklySeries(data, METRICS.delivery, scope), periodsFor(METRICS.delivery, data.weeks))!;
    expect(shift.after - shift.before).toBeGreaterThan(SCENARIOS.freightDisruption.extraDays - 2);
  });
});

/** The engine never reads SCENARIOS; these check that it rediscovers them from data alone. */
describe("ground-truth recovery", () => {
  it("produces the seven findings", () => {
    expect(findings.map((f) => f.id)).toEqual(["revenue", "churn", "margin", "delivery", "region", "marketing", "opportunity"]);
  });
  it("traces the revenue decline to the delayed product in Germany", () => {
    const inv = byId.revenue.investigation;
    expect(inv.leafScope.country).toBe("Germany");
    expect(inv.leafScope.product).toBe("Atlas Standing Desk");
    expect(inv.drivers[0].metric).toBe("delivery");
  });
  it("attributes margin compression to the discounted channel", () => {
    const inv = byId.margin.investigation;
    expect(inv.leafScope.channel).toBe(SCENARIOS.socialPromo.channel);
    expect(inv.drivers[0].metric).toBe("discount");
  });
  it("locates churn, acquisition cost, regional gap and opportunity", () => {
    expect(byId.churn.investigation.leafScope.channel).toBe(SCENARIOS.socialPromo.channel);
    expect(byId.marketing.investigation.leafScope.channel).toBe(SCENARIOS.searchSaturation.channel);
    expect(byId.region.scope.country).toBe("United Kingdom");
    expect(byId.opportunity.investigation.leafScope.category).toBe(SCENARIOS.smartHomePartnership.category);
    expect(byId.opportunity.tone).toBe("positive");
  });
  it("holds across other random seeds", () => {
    for (const seed of [7, 42]) {
      const other = detectFindings(generateDataset(seed));
      const revenue = other.find((f) => f.id === "revenue")!.investigation;
      expect(revenue.leafScope.product).toBe("Atlas Standing Desk");
      expect(revenue.leafScope.country).toBe("Germany");
    }
  });
});

describe("health score", () => {
  const health = computeHealth(data, findings);
  it("sums pillars to the total and stays within bounds", () => {
    expect(health.pillars.reduce((s, p) => s + p.max, 0)).toBe(100);
    expect(Math.round(health.pillars.reduce((s, p) => s + p.points, 0))).toBe(health.score);
    for (const p of health.pillars) for (const c of p.components) expect(c.points).toBeGreaterThanOrEqual(0);
  });
});
