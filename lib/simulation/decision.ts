import type { Finding } from "@/types/insights";
import { METRICS } from "@/lib/analytics/metrics";
import { formatEur, formatPct, formatSignedEur, formatSignedPct, formatValue } from "@/lib/format";
import { scopeLabel } from "@/lib/insights/narrative";
import { type Levers, type Model, type Outcome, type Parameter, PRICE_ELASTICITY, type Scenario, sameLevers, simulate, NO_CHANGE } from "./model";
import { describeLevers } from "./narrative";

/**
 * Decision support. Each scenario is evaluated under every combination of
 * plausible parameter values, and options are compared on their pessimistic
 * case as well as their expected one. The recommendation follows the maximin
 * rule: prefer the option whose worst case is best.
 */

/** Multipliers applied to assumed parameters, and standard-error steps applied to estimated ones. */
export const STRESS = { assumed: [0.5, 1, 1.5], estimated: [-1, 0, 1] };

type ParamId = keyof Model["params"];

function withParams(model: Model, values: Partial<Record<ParamId, number>>): Model {
  const params = { ...model.params };
  for (const id of Object.keys(values) as ParamId[]) params[id] = { ...params[id], value: values[id]! };
  return { ...model, params };
}

/** Parameters a scenario's result actually depends on, given which levers it moves. */
export function dependencies(model: Model, l: Levers): Parameter[] {
  const p = model.params;
  const out: Parameter[] = [];
  if (l.price || l.discount) out.push(p.priceElasticity);
  if (l.spend) out.push(p.spendElasticity);
  if (l.delivery) out.push(p.lateOnRepeat, p.lateOnReturns);
  if (l.delivery < 0) out.push(p.expediteCost);
  if (l.retention) out.push(p.retentionResponse);
  return out;
}

/** Best and worst outcome across every combination of plausible values of the parameters the scenario depends on. */
export function stress(model: Model, levers: Levers): { worst: Outcome; best: Outcome; cases: number } {
  const deps = dependencies(model, levers);
  const grids = deps.map((p): number[] => {
    if (p.id === "priceElasticity") return [PRICE_ELASTICITY.inelastic, PRICE_ELASTICITY.central, PRICE_ELASTICITY.elastic];
    if (p.source === "assumed") return STRESS.assumed.map((k) => p.value * k);
    return STRESS.estimated.map((k) => p.value + k * (p.se ?? 0));
  });
  // How much of a finding is actually recovered is as uncertain as any assumed parameter.
  const shares = levers.resolve > 0 ? [...new Set(STRESS.assumed.map((k) => Math.min(1, levers.resolve * k)))] : [levers.resolve];
  let worst = simulate(model, levers);
  let best = worst;
  let cases = 0;
  const walk = (i: number, values: Partial<Record<ParamId, number>>) => {
    if (i === deps.length) {
      for (const resolve of shares) {
        const o = simulate(withParams(model, values), { ...levers, resolve });
        cases++;
        if (o.profit < worst.profit) worst = o;
        if (o.profit > best.profit) best = o;
      }
      return;
    }
    for (const v of grids[i]) walk(i + 1, { ...values, [deps[i].id]: v });
  };
  walk(0, {});
  return { worst, best, cases };
}

export interface Option {
  scenario: Scenario;
  current: Outcome;
  expected: Outcome;
  worst: Outcome;
  best: Outcome;
  /** Parameter combinations evaluated. */
  cases: number;
  depends: Parameter[];
  /** A resolved finding is a return-to-baseline assumption, not a modelled response. */
  resolves: Finding | null;
}

export function evaluate(model: Model, scenarios: Scenario[], findings: Finding[]): Option[] {
  const current = simulate(model, NO_CHANGE);
  return scenarios.map((scenario) => ({
    scenario, current, expected: simulate(model, scenario.levers), ...stress(model, scenario.levers),
    depends: dependencies(model, scenario.levers),
    resolves: scenario.levers.resolve > 0 ? (findings.find((f) => f.id === scenario.levers.resolveId) ?? null) : null,
  }));
}

/** Maximin: the option with the highest pessimistic-case profit. */
export function recommend(options: Option[]): Option {
  return options.reduce((a, b) => (b.worst.profit > a.worst.profit ? b : a));
}

export interface Checkpoint {
  label: string;
  current: string;
  expected: string;
}

/** What to watch after acting: the metrics each moved lever should shift, with the model's expected values. */
export function checkpoints(model: Model, o: Option): Checkpoint[] {
  const l = o.scenario.levers;
  const c = o.current;
  const e = o.expected;
  const out: Checkpoint[] = [];
  const add = (label: string, current: string, expected: string) => out.push({ label, current, expected });
  if (l.price || l.discount) add("Orders per week", formatValue(c.orders, "count"), formatValue(e.orders, "count"));
  if (l.price || l.discount || l.spend) add("New customers per week", formatValue(c.acquisitions, "count"), formatValue(e.acquisitions, "count"));
  if (l.spend) add("Acquisition cost", formatEur(model.baseline.spend / c.acquisitions), formatEur((model.baseline.spend * (1 + l.spend)) / e.acquisitions));
  if (l.delivery) {
    add("Average delivery time", formatValue(c.deliveryDays, "days"), formatValue(e.deliveryDays, "days"));
    add("Return rate", formatValue(c.returnRate, "pct"), formatValue(e.returnRate, "pct"));
  }
  if (l.retention || l.delivery) add("Repeat purchase rate", formatValue(c.repeatRate, "pct"), formatValue(e.repeatRate, "pct"));
  if (o.resolves) {
    const f = o.resolves;
    const m = METRICS[f.metric];
    const leaf = f.investigation.leafEffect;
    add(`${m.label} · ${scopeLabel(f.investigation.leafScope)}`, formatValue(leaf.after, m.unit), formatValue(leaf.after + (leaf.before - leaf.after) * l.resolve, m.unit));
  }
  add("Contribution margin", formatValue(c.margin, "pct"), formatValue(e.margin, "pct"));
  return out;
}

const rel = (after: number, before: number): number => (before !== 0 ? after / before - 1 : 0);

export interface Brief {
  statement: string;
  facts: string[];
}

export function decisionBrief(model: Model, option: Option, options: Option[], findings: Finding[]): Brief {
  const best = recommend(options);
  const { scenario, current: c, expected: e, worst: w } = option;
  const changes = describeLevers(model, scenario.levers, findings);
  const expected = `${formatEur(c.profit)} to ${formatEur(e.profit)} a week (${formatSignedPct(rel(e.profit, c.profit))})`;
  const pessimistic = formatSignedPct(rel(w.profit, c.profit));
  const assumed = option.depends.filter((p) => p.source === "assumed").length + (option.resolves ? 1 : 0);
  const facts = [
    `Options compared: ${options.length}`,
    `Expected contribution profit after marketing: ${expected}`,
    `Pessimistic case: ${pessimistic}, across ${option.cases} parameter ${option.cases === 1 ? "combination" : "combinations"}`,
    `Expected revenue: ${formatEur(c.revenue)} to ${formatEur(e.revenue)} a week (${formatSignedPct(rel(e.revenue, c.revenue))})`,
    `Rests on ${assumed} assumptions`,
    ...changes,
    ...options.map((o) => `${o.scenario.name}: pessimistic case ${formatSignedPct(rel(o.worst.profit, o.current.profit))}`),
  ];

  if (sameLevers(scenario.levers, NO_CHANGE)) {
    const better = best !== option;
    return {
      statement: `Keep the current strategy: contribution profit after marketing stays at ${formatEur(c.profit)} a week.` +
        (better ? ` ${best.scenario.name} does better even in its pessimistic case (${formatSignedPct(rel(best.worst.profit, best.current.profit))}).` : " None of the options compared improves on it in its pessimistic case."),
      facts,
    };
  }
  let statement = `${scenario.name}: ${changes.join(", ")}. The model expects contribution profit after marketing to move from ${expected}; in the pessimistic case the change is ${pessimistic}.`;
  if (best === option) statement += ` Of the ${options.length} options compared, this one has the best pessimistic case.`;
  else statement += ` ${best.scenario.name} has a better pessimistic case (${formatSignedPct(rel(best.worst.profit, best.current.profit))}).`;
  if (assumed) statement += ` The result rests on ${assumed} ${assumed === 1 ? "assumption" : "assumptions"} the data cannot confirm, so treat it as a case to test, not a forecast.`;
  return { statement, facts };
}

/** Plain-text brief for sharing outside the product. */
export function exportBrief(model: Model, option: Option, options: Option[], findings: Finding[]): string {
  const { scenario, current: c, expected: e, worst: w, best: b } = option;
  const lines = [
    `DECISION BRIEF — ${scenario.name}`,
    "",
    decisionBrief(model, option, options, findings).statement,
    "",
    "PROJECTED WEEKLY RUN-RATE",
    `Revenue: ${formatEur(c.revenue)} → ${formatEur(e.revenue)} (${formatSignedPct(rel(e.revenue, c.revenue))})`,
    `Profit: ${formatEur(c.profit)} → ${formatEur(e.profit)} (${formatSignedPct(rel(e.profit, c.profit))})`,
    `Range: ${formatSignedPct(rel(w.profit, c.profit))} to ${formatSignedPct(rel(b.profit, c.profit))} across ${option.cases} parameter ${option.cases === 1 ? "combination" : "combinations"}`,
    `Annualised expected profit change: ${formatSignedEur((e.profit - c.profit) * 52)}`,
    "",
    "RESTS ON",
    ...option.depends.map((p) => `- ${p.label} (${p.source}${p.se !== undefined ? `, ± ${p.se.toPrecision(2)}` : ""})`),
    ...(option.resolves ? [`- ${formatPct(scenario.levers.resolve)} of "${option.resolves.title}" returning to baseline (assumed)`] : []),
    ...(option.depends.length || option.resolves ? [] : ["- No change, no model parameters involved"]),
    "",
    "WATCH",
    ...checkpoints(model, option).map((k) => `- ${k.label}: ${k.current} → ${k.expected}`),
    "",
    "OPTIONS COMPARED (expected / pessimistic profit)",
    ...options.map((o) => `- ${o.scenario.name}: ${formatSignedPct(rel(o.expected.profit, o.current.profit))} / ${formatSignedPct(rel(o.worst.profit, o.current.profit))}`),
    "",
    "Steady-state model on synthetic data. Not a forecast.",
  ];
  return lines.join("\n");
}
