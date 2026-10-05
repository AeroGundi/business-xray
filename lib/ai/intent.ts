import type { Dataset } from "@/types/domain";
import { DIM_LABEL, METRICS, type DimKey, type MetricId, type Scope } from "@/lib/analytics/metrics";

/**
 * Step 1 of "Ask the Business": question → intent.
 *
 * A deterministic, rule-based interpreter. It only recognises what the
 * analytics engine can actually compute, and returns "unknown" otherwise —
 * a question is never answered by guessing.
 */

export type Intent =
  /** Explain how and why a metric changed, optionally within a segment. */
  | { kind: "explain"; metric: MetricId; scope: Scope }
  /** Compare the members of a dimension on a metric. */
  | { kind: "rank"; metric: MetricId; dim: DimKey; scope: Scope }
  /** Summarise what stands out across the business. */
  | { kind: "overview" }
  | { kind: "unknown"; reason: string };

export interface Interpretation {
  intent: Intent;
  /** Human-readable reading of the question, shown before the answer. */
  summary: string;
}

/** Ordered: more specific phrases first. */
const METRIC_TERMS: [RegExp, MetricId][] = [
  [/acquisition cost|\bcac\b|cost per customer|marketing (efficien|roi|perform)|ad spend efficien/, "cac"],
  [/shipping cost|logistics cost|freight cost/, "shipping"],
  [/on[- ]time/, "onTime"],
  [/churn|retention|retain|repeat|repurchase|loyal|at risk|leaving|coming back|come back/, "repurchase"],
  [/margin|profit/, "margin"],
  [/deliver|late\b|delay|lead time|logistics|shipping/, "delivery"],
  [/return|refund/, "returns"],
  [/discount|promo/, "discount"],
  [/order value|basket|\baov\b|ticket/, "aov"],
  [/new customers|acquisitions?\b|sign[- ]?ups/, "acquisitions"],
  [/marketing spend|ad spend|budget/, "spend"],
  [/revenue|sales|turnover|income/, "revenue"],
  [/\borders\b|volume|demand/, "orders"],
];

const DIM_TERMS: [RegExp, DimKey][] = [
  [/countr|market|region|where|geograph/, "country"],
  [/product|item|sku/, "product"],
  [/categor/, "category"],
  [/channel|source|campaign/, "channel"],
  [/customer|segment|who\b|audience/, "segment"],
];

const ALIASES: Record<string, [DimKey, string]> = {
  uk: ["country", "United Kingdom"], britain: ["country", "United Kingdom"], german: ["country", "Germany"],
  french: ["country", "France"], spanish: ["country", "Spain"], italian: ["country", "Italy"], dutch: ["country", "Netherlands"],
  smes: ["segment", "SME"], "small business": ["segment", "SME"], b2b: ["segment", "SME"],
  consumers: ["segment", "Consumer"], prosumers: ["segment", "Prosumer"],
  social: ["channel", "Paid Social"], search: ["channel", "Paid Search"], affiliate: ["channel", "Affiliates"],
  desk: ["product", "Atlas Standing Desk"], desks: ["product", "Atlas Standing Desk"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (q: string, term: string) => new RegExp(`(^|[^a-z])${escape(term.toLowerCase())}($|[^a-z])`).test(q);

function members(data: Dataset): Record<DimKey, string[]> {
  return {
    country: data.countries.map((c) => c.name),
    product: data.products.map((p) => p.name),
    category: [...new Set(data.products.map((p) => p.category))],
    segment: [...new Set(data.customers.map((c) => c.segment))],
    channel: data.channels.map((c) => c.id),
  };
}

export function detectScope(question: string, data: Dataset): Scope {
  const q = question.toLowerCase();
  const scope: Scope = {};
  const all = members(data);
  // Longest names first so "Paid Social" wins over a bare "social".
  for (const dim of Object.keys(all) as DimKey[]) {
    const hit = [...all[dim]].sort((a, b) => b.length - a.length).find((m) => mentions(q, m));
    if (hit) scope[dim] = hit;
  }
  for (const [alias, [dim, member]] of Object.entries(ALIASES)) {
    if (!scope[dim] && mentions(q, alias)) scope[dim] = member;
  }
  return scope;
}

export const scopeText = (scope: Scope): string => {
  const parts = (Object.keys(scope) as DimKey[]).map((d) => scope[d]!);
  return parts.length ? parts.join(" · ") : "whole business";
};

export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case "explain":
      return `Explain the change in ${METRICS[intent.metric].noun} · ${scopeText(intent.scope)} · last 10 weeks vs previous 10`;
    case "rank":
      return `Compare ${METRICS[intent.metric].noun} by ${DIM_LABEL[intent.dim].toLowerCase()} · ${scopeText(intent.scope)}`;
    case "overview":
      return "Summarise the significant changes of the last 10 weeks";
    default:
      return "No analysis matched";
  }
}

export function interpret(question: string, data: Dataset): Interpretation {
  const q = question.toLowerCase().trim();
  const done = (intent: Intent): Interpretation => ({ intent, summary: describeIntent(intent) });
  if (q.length < 3) return done({ kind: "unknown", reason: "The question is empty." });

  const scope = detectScope(q, data);
  const metric = METRIC_TERMS.find(([re]) => re.test(q))?.[1];
  const comparative = /^(which|who)\b|\b(top|worst|best|highest|lowest|most|least|rank|compare|by (country|product|category|channel|segment))\b/.test(q);
  // A dimension only counts for ranking if the question has not already fixed one of its members.
  const dim = DIM_TERMS.find(([re, d]) => re.test(q) && !(d in scope))?.[1];

  if (metric && comparative && dim && METRICS[metric].source === "orders") return done({ kind: "rank", metric, dim, scope });
  if (metric && comparative && dim && METRICS[metric].source === "marketing" && (dim === "country" || dim === "channel")) {
    return done({ kind: "rank", metric, dim, scope });
  }
  if (metric) return done({ kind: "explain", metric, scope });
  if (/what.*(chang|happen|wrong|going on|investigat|look at|stand|matter|worry)|summar|overview|anything|biggest (problem|risk|issue)/.test(q)) {
    return done({ kind: "overview" });
  }
  return done({ kind: "unknown", reason: "No metric or business area was recognised in the question." });
}

export const SUGGESTIONS = [
  "What changed this quarter?",
  "Why did revenue fall in Germany?",
  "Which customers are most at risk?",
  "Where are we losing margin?",
  "Which countries have the slowest delivery?",
];
