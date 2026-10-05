import { describe, expect, it } from "vitest";
import { generateDataset } from "@/lib/data/generate";
import { checkGrounding } from "@/lib/ai/grounding";
import { detectFindings } from "@/lib/insights/findings";
import { checkpoints, decisionBrief, dependencies, evaluate, exportBrief, recommend, stress } from "@/lib/simulation/decision";
import { calibrate, NO_CHANGE, presets, simulate } from "@/lib/simulation/model";

const data = generateDataset();
const findings = detectFindings(data);
const model = calibrate(data, findings);
const options = evaluate(model, presets(model), findings);

describe("stress test", () => {
  it("brackets the expected outcome", () => {
    for (const o of options) {
      expect(o.worst.profit).toBeLessThanOrEqual(o.expected.profit + 1e-9);
      expect(o.best.profit).toBeGreaterThanOrEqual(o.expected.profit - 1e-9);
    }
  });
  it("has no spread when nothing changes", () => {
    const s = stress(model, NO_CHANGE);
    expect(s.cases).toBe(1);
    expect(s.worst.profit).toBeCloseTo(simulate(model, NO_CHANGE).profit, 9);
  });
  it("only varies the parameters a scenario depends on", () => {
    expect(dependencies(model, { ...NO_CHANGE, price: 0.05 }).map((p) => p.id)).toEqual(["priceElasticity"]);
    expect(stress(model, { ...NO_CHANGE, price: 0.05 }).cases).toBe(3);
    expect(dependencies(model, { ...NO_CHANGE, delivery: -1 }).map((p) => p.id)).toContain("expediteCost");
    expect(dependencies(model, { ...NO_CHANGE, delivery: 1 }).map((p) => p.id)).not.toContain("expediteCost");
  });
});

describe("recommendation", () => {
  it("follows the maximin rule", () => {
    const best = recommend(options);
    for (const o of options) expect(best.worst.profit).toBeGreaterThanOrEqual(o.worst.profit);
  });
});

describe("brief", () => {
  it("states only figures that are in its facts, for every option", () => {
    for (const o of options) {
      const b = decisionBrief(model, o, options, findings);
      expect(checkGrounding(b.statement, b.facts).unsupported).toEqual([]);
    }
  });
  it("lists what to watch and exports as text", () => {
    const o = options.find((x) => x.scenario.levers.retention > 0)!;
    expect(checkpoints(model, o).map((k) => k.label)).toContain("Repeat purchase rate");
    const text = exportBrief(model, o, options, findings);
    expect(text).toContain("DECISION BRIEF");
    expect(text).toContain("assumed");
  });
});
