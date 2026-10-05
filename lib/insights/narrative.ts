import type { Driver, Finding } from "@/types/insights";
import { DIMS, METRICS, type DimKey, type Metric, type Scope } from "@/lib/analytics/metrics";
import { formatChange, formatP, formatPct, formatValue } from "@/lib/format";

/**
 * Deterministic, template-based language. Every number in a sentence is read
 * from a structured analytical result; wording is deliberately hedged because
 * the evidence is observational.
 */

const ORDER: DimKey[] = ["product", "category", "segment", "channel", "country"];

export function scopeParts(scope: Scope): string[] {
  return ORDER.filter((d) => scope[d]).map((d) => scope[d]!);
}

export function scopeLabel(scope: Scope): string {
  const parts = scopeParts(scope);
  return parts.length ? parts.join(" · ") : "Whole business";
}

/** "SME customers buying Atlas Standing Desk in Germany" */
export function scopePhrase(scope: Scope): string {
  const who = scope.segment ? `${scope.segment} customers` : "customers";
  const bits = [who];
  if (scope.channel) bits.push(`acquired via ${scope.channel}`);
  if (scope.product) bits.push(`buying ${scope.product}`);
  else if (scope.category) bits.push(`buying ${scope.category}`);
  if (scope.country) bits.push(`in ${scope.country}`);
  return bits.length === 1 && !scope.segment ? "the whole business" : bits.join(" ");
}

export const verb = (change: number): string => (change < 0 ? "fell" : "rose");

export function changeText(metric: Metric, f: { change: number; changePct: number }): string {
  return formatChange(f.change, f.changePct, metric.unit);
}

export function periodText(f: Finding): string {
  const w = f.comparison.periods;
  return f.comparison.kind === "time"
    ? `last ${w.recent.to - w.recent.from} weeks vs previous ${w.baseline.to - w.baseline.from}`
    : `last ${w.recent.to - w.baseline.from} weeks vs other ${DIMS_PLURAL[f.comparison.peerDim]}`;
}

const DIMS_PLURAL: Record<DimKey, string> = {
  country: "countries", category: "categories", product: "products", segment: "segments", channel: "channels",
};

export function headline(f: Finding): string {
  const metric = METRICS[f.metric];
  const where = Object.keys(f.scope).length ? ` in ${scopeLabel(f.scope)}` : "";
  return `${metric.label}${where}`;
}

export function detectionSentence(f: Finding): string {
  const metric: Metric = METRICS[f.metric];
  const e = f.effect;
  const base = `${metric.label} ${verb(e.change)} from ${formatValue(e.before, metric.unit)} to ${formatValue(e.after, metric.unit)}`;
  if (f.comparison.kind === "peers") {
    return `${metric.label} is ${formatValue(e.after, metric.unit)} against ${formatValue(e.before, metric.unit)} across other ${DIMS_PLURAL[f.comparison.peerDim]} — ${Math.abs(f.z).toFixed(1)} robust standard deviations from the peer median.`;
  }
  return `${base}. A move this size is ${Math.abs(f.z).toFixed(1)} robust standard deviations from what this series normally does between periods.`;
}

export function driverSentence(d: Driver, kind: "time" | "peers"): string {
  const m: Metric = METRICS[d.metric];
  const move = `${formatValue(d.before, m.unit)} → ${formatValue(d.after, m.unit)}`;
  const control = d.controlChange !== null
    ? ` Elsewhere it moved ${formatChange(d.controlChange, d.before ? d.controlChange / Math.abs(d.before) : 0, m.unit)}.`
    : "";
  return kind === "time" ? `${move}.${control}` : `${move} (peers → here).`;
}

/** The hedged root-cause statement. */
export function causeStatement(f: Finding): string {
  const metric: Metric = METRICS[f.metric];
  const inv = f.investigation;
  const lead = inv.drivers[0];
  const where = scopePhrase(inv.leafScope);
  const share = inv.steps.length ? ` This segment accounts for ${formatPct(Math.min(1, Math.max(0, inv.shareOfRoot)))} of the change observed.` : "";
  if (!lead) {
    return `The change in ${metric.noun} is localised to ${where}, but none of the operational metrics tested shifted significantly there. The data does not show a likely contributor.${share}`;
  }
  const lm: Metric = METRICS[lead.metric];
  if (f.comparison.kind === "peers") {
    return `Evidence suggests the gap in ${metric.noun} for ${where} is associated with ${lm.noun}: ${formatValue(lead.after, lm.unit)} here against ${formatValue(lead.before, lm.unit)} for peers (${formatP(lead.p)}).`;
  }
  const isolated = lead.controlChange !== null && Math.abs(lead.controlChange) < Math.abs(lead.change) * 0.25
    ? " The shift is absent from the rest of the business." : "";
  return `Evidence suggests ${lm.noun} is a likely contributor: for ${where} it ${verb(lead.change)} from ${formatValue(lead.before, lm.unit)} to ${formatValue(lead.after, lm.unit)} (${formatP(lead.p)}) as ${metric.noun} ${verb(inv.leafEffect.change)}.${isolated}${share}`;
}

export const CAVEAT = "Observational evidence: statistically significant association, not proof of causation.";

export function nextQuestion(dim: DimKey | "cause" | "impact"): string {
  if (dim === "cause") return "Why?";
  if (dim === "impact") return "How important is it?";
  return { country: "Where?", category: "In which category?", product: "Which product?", segment: "Which customers?", channel: "Through which channel?" }[dim];
}

export { DIMS };
