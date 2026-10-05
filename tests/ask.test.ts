import { describe, expect, it } from "vitest";
import { generateDataset } from "@/lib/data/generate";
import { ask } from "@/lib/ai/answer";
import { checkGrounding, numbersIn } from "@/lib/ai/grounding";
import { interpret } from "@/lib/ai/intent";
import { detectFindings } from "@/lib/insights/findings";
import { openHypotheses, testHypothesis } from "@/lib/insights/hypotheses";

const data = generateDataset();
const findings = detectFindings(data);

describe("intent", () => {
  const intentOf = (q: string) => interpret(q, data).intent;
  it("reads metric and segment from an explanatory question", () => {
    expect(intentOf("Why did revenue fall in Germany?")).toEqual({ kind: "explain", metric: "revenue", scope: { country: "Germany" } });
    expect(intentOf("Where are we losing margin?")).toEqual({ kind: "explain", metric: "margin", scope: {} });
    expect(intentOf("What is causing the revenue decline?")).toEqual({ kind: "explain", metric: "revenue", scope: {} });
  });
  it("reads comparisons", () => {
    expect(intentOf("Which customers are most at risk?")).toEqual({ kind: "rank", metric: "repurchase", dim: "segment", scope: {} });
    expect(intentOf("Which countries have the slowest delivery?")).toEqual({ kind: "rank", metric: "delivery", dim: "country", scope: {} });
  });
  it("resolves aliases and multi-word members", () => {
    expect(intentOf("why are returns up for SMEs in the UK")).toEqual({ kind: "explain", metric: "returns", scope: { country: "United Kingdom", segment: "SME" } });
    expect(intentOf("how is margin on paid social")).toMatchObject({ metric: "margin", scope: { channel: "Paid Social" } });
  });
  it("reads open questions as an overview and refuses what it cannot map", () => {
    expect(intentOf("What changed this quarter?").kind).toBe("overview");
    expect(intentOf("What should we investigate?").kind).toBe("overview");
    expect(intentOf("What is the weather in Madrid?").kind).toBe("unknown");
  });
});

describe("answers", () => {
  it("turns an explanatory question into an investigation with evidence", () => {
    const r = ask(data, findings, "Why did revenue fall in Germany?");
    if (r.type !== "finding") throw new Error("expected an investigation");
    expect(r.finding.effect.change).toBeLessThan(0);
    expect(r.finding.investigation.leafScope.product).toBe("Atlas Standing Desk");
    expect(r.finding.investigation.drivers[0].metric).toBe("delivery");
  });
  it("reuses the scan's finding when the question matches it", () => {
    const r = ask(data, findings, "What is causing the revenue decline?");
    if (r.type !== "finding") throw new Error("expected an investigation");
    expect(r.finding.id).toBe("revenue");
  });
  it("ranks worst first and only states figures present in its facts", () => {
    const r = ask(data, findings, "Which countries have the slowest delivery?");
    if (r.type !== "answer") throw new Error("expected an answer");
    expect(r.answer.rows[0].label).toBe("United Kingdom");
    expect(checkGrounding(r.answer.explanation, r.answer.facts).grounded).toBe(true);
  });
  it("grounds the overview explanation in its facts", () => {
    const r = ask(data, findings, "What changed this quarter?");
    if (r.type !== "answer") throw new Error("expected an answer");
    expect(r.answer.rows).toHaveLength(findings.length);
    expect(checkGrounding(r.answer.explanation, r.answer.facts).grounded).toBe(true);
  });
  it("declines rather than guesses", () => {
    const r = ask(data, findings, "Tell me a joke");
    expect(r.type === "answer" && r.answer.kind).toBe("unknown");
  });
});

describe("grounding", () => {
  const facts = ["Delivery time: 7.2 d to 16.3 d, change +9.1 d, p < 0.001", "64% of the change"];
  it("normalises figures", () => {
    expect(numbersIn("€1,234.50 and 12.0%")).toEqual(["1234.50", "12"]);
  });
  it("accepts wording that reuses the given figures", () => {
    expect(checkGrounding("Delivery slowed from 7.2 to 16.3 days, covering 64% of the drop.", facts).grounded).toBe(true);
  });
  it("rejects invented or recomputed figures", () => {
    const r = checkGrounding("Delivery more than doubled, up 126%, costing roughly 300 orders.", facts);
    expect(r.grounded).toBe(false);
    expect(r.unsupported).toEqual(["126", "300"]);
  });
});

describe("hypotheses", () => {
  const revenue = findings.find((f) => f.id === "revenue")!;
  it("offers only what the root-cause stage has not already confirmed", () => {
    const open = openHypotheses(revenue, data).map((h) => h.metric);
    expect(open).not.toContain("delivery");
    expect(open).toContain("discount");
  });
  it("agrees with the engine when re-testing a confirmed driver", () => {
    expect(testHypothesis(data, revenue, "delivery").supported).toBe(true);
  });
});
