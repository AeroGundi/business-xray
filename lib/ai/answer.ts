import type { Dataset } from "@/types/domain";
import type { Finding, FindingId, Tone } from "@/types/insights";
import { aggregatePairs, effectOf, splitBy, type Comparison } from "@/lib/analytics/compare";
import { DIM_LABEL, METRICS, type Metric, periodsFor, weeklySeries } from "@/lib/analytics/metrics";
import { detectShift } from "@/lib/anomaly/detect";
import { formatChange, formatPct, formatSignedEur, formatValue } from "@/lib/format";
import { scopeLabel } from "@/lib/insights/narrative";
import { investigate } from "@/lib/root-cause/investigate";
import { HUE, type ViewSpec } from "@/lib/visualization/layout";
import { describeIntent, interpret, scopeText, suggestionsFor, type Intent } from "./intent";

/**
 * Steps 2–3 of "Ask the Business": intent → analytical function → structured
 * result. Every figure in an Answer is computed here from the data; the
 * explanation is a template over those figures and the `facts` list is what a
 * language model is allowed to rephrase.
 */

export interface AnswerRow {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
  /** Selecting the row continues the investigation. */
  action?: { finding: FindingId } | { intent: Intent };
}

export interface Answer {
  question: string;
  interpretation: string;
  kind: "rank" | "overview" | "unknown";
  explanation: string;
  facts: string[];
  rowsTitle: string;
  rows: AnswerRow[];
  /** What the visualization shows for this answer; null keeps the overview. */
  view: ViewSpec | null;
  next: { label: string; action: NonNullable<AnswerRow["action"]> } | null;
}

export type Resolution = { type: "finding"; finding: Finding } | { type: "answer"; answer: Answer };

/** Fewer fact rows than this and a segment is too thin to analyse. */
const MIN_ROWS = 60;

const sameScope = (a: object, b: object) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function unknown(data: Dataset, question: string, reason: string): Answer {
  return {
    question, interpretation: describeIntent({ kind: "unknown", reason }), kind: "unknown",
    explanation: `${reason} I can only answer questions that map to an analysis of the data: how a metric changed, where, and what moved with it.`,
    facts: [], rowsTitle: "Questions I can answer",
    rows: suggestionsFor(data).map((s) => ({ label: s, value: "" })),
    view: null, next: null,
  };
}

function explain(data: Dataset, findings: Finding[], question: string, intent: Extract<Intent, { kind: "explain" }>): Resolution {
  const interpretation = describeIntent(intent);
  // The scan may already have investigated exactly this; reuse it so the two never disagree.
  const existing = findings.find((f) => f.metric === intent.metric && f.comparison.kind === "time" && sameScope(f.scope, intent.scope));
  if (existing) return { type: "finding", finding: { ...existing, question, interpretation } };

  const metric: Metric = METRICS[intent.metric];
  const comparison: Comparison = { kind: "time", periods: periodsFor(metric, data.weeks) };
  const pair = aggregatePairs(data, metric, intent.scope, comparison).total;
  if (pair.a.n + pair.b.n < MIN_ROWS) {
    return { type: "answer", answer: unknown(data, question, `There is too little data for ${scopeText(intent.scope)} to analyse ${metric.noun} reliably.`) };
  }
  const effect = effectOf(metric, pair, comparison);
  const shift = detectShift(metric, weeklySeries(data, metric, intent.scope), comparison.periods);
  const confidence = shift?.confidence ?? 0;
  const good = effect.change * metric.polarity > 0;
  return {
    type: "finding",
    finding: {
      id: "ask", index: 0, title: "Your question", metric: intent.metric, scope: intent.scope, comparison, effect,
      expected: shift?.expected ?? null, z: shift?.z ?? 0, confidence,
      tone: good ? "positive" : confidence >= 0.95 ? "risk" : "attention",
      investigation: investigate(data, intent.metric, intent.scope, comparison),
      question, interpretation,
    },
  };
}

function rank(data: Dataset, question: string, intent: Extract<Intent, { kind: "rank" }>): Answer {
  const metric: Metric = METRICS[intent.metric];
  const comparison: Comparison = { kind: "time", periods: periodsFor(metric, data.weeks) };
  const split = splitBy(data, metric, intent.scope, comparison, intent.dim);
  const members = split.members.filter((m) => m.n >= MIN_ROWS);
  if (members.length < 2) return unknown(data, question, `There are not enough ${DIM_LABEL[intent.dim].toLowerCase()} members with data to compare.`);

  // Worst first: lowest value when higher is better, highest when lower is better.
  const direction = metric.polarity < 0 ? -1 : 1;
  members.sort((a, b) => (a.after - b.after) * direction);
  const worst = members[0];
  const best = members[members.length - 1];
  const mover = [...members].sort((a, b) => (a.change - b.change) * direction)[0];
  const value = (x: number) => formatValue(x, metric.unit);
  const change = (m: { change: number; changePct: number }) => formatChange(m.change, m.changePct, metric.unit);
  const dimName = DIM_LABEL[intent.dim].toLowerCase();
  const where = Object.keys(intent.scope).length ? ` within ${scopeText(intent.scope)}` : "";
  const extreme = metric.polarity < 0 ? "highest" : "lowest";

  const explanation =
    `${metric.label} is ${extreme} for ${worst.member} at ${value(worst.after)}${where}, against ${value(best.after)} for ${best.member}. ` +
    (mover.member === worst.member
      ? `It is also where it moved most over the last 10 weeks (${change(mover)}).`
      : `The largest move over the last 10 weeks was in ${mover.member} (${change(mover)}).`);

  const lo = Math.min(worst.after, best.after);
  const hi = Math.max(worst.after, best.after);
  const badness = (v: number) => (hi === lo ? 0 : direction > 0 ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
  const neutral = metric.polarity === 0;

  return {
    question, interpretation: describeIntent(intent), kind: "rank", explanation,
    facts: ["last 10 weeks vs previous 10 weeks", ...members.map((m) => `${m.member}: ${value(m.after)}, previously ${value(m.before)}, change ${change(m)}`)],
    rowsTitle: `${metric.label} by ${dimName}`,
    rows: members.map((m, i) => ({
      label: m.member, value: value(m.after), detail: `${change(m)} vs previous 10 weeks`,
      tone: neutral ? undefined : i === 0 ? "risk" : undefined,
      action: { intent: { kind: "explain", metric: intent.metric, scope: { ...intent.scope, [intent.dim]: m.member } } },
    })),
    view: {
      mode: "cluster", scope: intent.scope, dim: intent.dim, hue: HUE.risk,
      heat: neutral ? {} : Object.fromEntries(members.map((m) => [m.member, Math.pow(badness(m.after), 1.5)])),
      notes: Object.fromEntries(members.map((m) => [m.member, value(m.after)])),
    },
    next: {
      label: `Why ${worst.member}?`,
      action: { intent: { kind: "explain", metric: intent.metric, scope: { ...intent.scope, [intent.dim]: worst.member } } },
    },
  };
}

function overview(findings: Finding[], question: string): Answer {
  const ranked = [...findings].sort((a, b) => impactSize(b) - impactSize(a));
  const top = ranked[0];
  const significant = findings.filter((f) => f.confidence >= 0.95).length;
  const line = (f: Finding) => `${f.title} (${METRICS[f.metric].label}, ${scopeLabel(f.investigation.leafScope)}): ${changeOf(f)}, confidence ${formatPct(f.confidence)}${impactText(f) ? `, estimated impact ${impactText(f)}` : ""}`;
  return {
    question, interpretation: describeIntent({ kind: "overview" }), kind: "overview",
    explanation: top
      ? `${findings.length} signals stand out over the last 10 weeks, ${significant} of them statistically significant. The largest by estimated impact is ${top.title.toLowerCase()} in ${scopeLabel(top.investigation.leafScope)} (${changeOf(top)}${impactText(top) ? `, ${impactText(top)}` : ""}).`
      : "Nothing stands out over the last 10 weeks.",
    facts: ["last 10 weeks", `${findings.length} signals`, `${significant} statistically significant`, ...findings.map(line)],
    rowsTitle: "Ranked by estimated impact",
    rows: ranked.map((f) => ({
      label: f.title, value: changeOf(f), tone: f.tone,
      detail: [scopeLabel(f.investigation.leafScope), impactText(f)].filter(Boolean).join(" · "),
      action: { finding: f.id },
    })),
    view: null,
    next: top ? { label: `Investigate ${top.title.toLowerCase()}`, action: { finding: top.id } } : null,
  };
}

const changeOf = (f: Finding): string => formatChange(f.effect.change, f.effect.changePct, METRICS[f.metric].unit);
const impactSize = (f: Finding): number => (f.investigation.impact.unit === "eur" ? Math.abs(f.investigation.impact.value) : 0);
const impactText = (f: Finding): string => (f.investigation.impact.unit === "eur" ? formatSignedEur(f.investigation.impact.value) : "");

export function resolveIntent(data: Dataset, findings: Finding[], question: string, intent: Intent): Resolution {
  switch (intent.kind) {
    case "explain":
      return explain(data, findings, question, intent);
    case "rank":
      return { type: "answer", answer: rank(data, question, intent) };
    case "overview":
      return { type: "answer", answer: overview(findings, question) };
    default:
      return { type: "answer", answer: unknown(data, question, intent.reason) };
  }
}

/** The whole pipeline: question → intent → analysis → structured result. */
export function ask(data: Dataset, findings: Finding[], question: string): Resolution {
  return resolveIntent(data, findings, question, interpret(question, data).intent);
}
