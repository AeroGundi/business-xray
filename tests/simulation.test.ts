import { describe, expect, it } from "vitest";
import { generateDataset } from "@/lib/data/generate";
import { checkGrounding } from "@/lib/ai/grounding";
import { detectFindings } from "@/lib/insights/findings";
import { fixedEffectsSlope } from "@/lib/simulation/estimate";
import { calibrate, NO_CHANGE, presets, project, simulate } from "@/lib/simulation/model";
import { scenarioExplanation } from "@/lib/simulation/narrative";

const data = generateDataset();
const findings = detectFindings(data);
const model = calibrate(data, findings);
const base = simulate(model, NO_CHANGE);

describe("estimation", () => {
  it("recovers a known slope and ignores group offsets", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ x: i % 10, y: 3 * (i % 10) + (i % 2 ? 100 : 0), group: i % 2 ? "a" : "b" }));
    expect(fixedEffectsSlope(rows).value).toBeCloseTo(3, 8);
  });
  it("estimates the acquisition elasticity near the generator's 0.6", () => {
    const e = model.params.spendElasticity;
    expect(Math.abs(e.value - 0.6)).toBeLessThan(2.5 * e.se!);
  });
  it("finds late deliveries raise returns", () => {
    expect(model.params.lateOnReturns.value).toBeGreaterThan(0.005);
  });
});

describe("what-if model", () => {
  it("reproduces observed revenue with no change", () => {
    const observed = data.orders.filter((o) => o.week >= data.weeks - 10).reduce((s, o) => s + o.revenue, 0) / 10;
    expect(base.revenue).toBeCloseTo(observed, 4);
  });
  it("responds in the expected direction to each lever", () => {
    expect(simulate(model, { ...NO_CHANGE, price: 0.05 }).orders).toBeLessThan(base.orders);
    expect(simulate(model, { ...NO_CHANGE, discount: 0.05 }).orders).toBeGreaterThan(base.orders);
    expect(simulate(model, { ...NO_CHANGE, spend: 0.2 }).acquisitions).toBeGreaterThan(base.acquisitions);
    expect(simulate(model, { ...NO_CHANGE, delivery: 2 }).returnRate).toBeGreaterThan(base.returnRate);
    expect(simulate(model, { ...NO_CHANGE, retention: 4000 }).repeatRate).toBeGreaterThan(base.repeatRate);
  });
  it("shows diminishing returns to marketing spend", () => {
    const gain = (m: number) => simulate(model, { ...NO_CHANGE, spend: m }).acquisitions - base.acquisitions;
    expect(gain(1)).toBeLessThan(2 * gain(0.5));
  });
  it("charges for what a scenario spends", () => {
    const withBudget = simulate(model, { ...NO_CHANGE, retention: 4000 });
    const free = simulate({ ...model, params: { ...model.params, retentionResponse: { ...model.params.retentionResponse, value: 0 } } }, { ...NO_CHANGE, retention: 4000 });
    expect(free.profit).toBeCloseTo(base.profit - 4000, 6);
    expect(withBudget.profit).toBeGreaterThan(free.profit);
  });
  it("orders the price-sensitivity range", () => {
    const p = project(model, { ...NO_CHANGE, price: 0.06 });
    expect(p.range.inelastic.profit).toBeGreaterThan(p.outcome.profit);
    expect(p.outcome.profit).toBeGreaterThan(p.range.elastic.profit);
  });
  it("adds a resolved finding's weekly impact", () => {
    const fix = model.resolvable[0];
    const o = simulate(model, { ...NO_CHANGE, resolve: 0.5, resolveId: fix.id });
    expect(o.profit - base.profit).toBeCloseTo(fix.profitPerWeek * 0.5, 6);
  });
  it("explains every preset using only figures from its facts", () => {
    for (const s of presets(model)) {
      const { text, facts } = scenarioExplanation(model, s.levers, project(model, s.levers), findings);
      expect(checkGrounding(text, facts).unsupported).toEqual([]);
    }
  });
});
