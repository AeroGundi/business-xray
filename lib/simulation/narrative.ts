import type { Finding } from "@/types/insights";
import { formatEur, formatPct, formatSignedPct, formatValue } from "@/lib/format";
import { type Levers, type Model, PRICE_ELASTICITY, type Projection } from "./model";

/** Template interpretation of a simulated scenario, with the facts a language model may rephrase. */

const rel = (after: number, before: number): number => (before !== 0 ? after / before - 1 : 0);

export function describeLevers(model: Model, l: Levers, findings: Finding[]): string[] {
  const b = model.baseline;
  const out: string[] = [];
  if (l.price) out.push(`prices ${formatSignedPct(l.price, 0)}`);
  if (l.discount) out.push(`discount depth ${formatValue(b.discount, "pct")} to ${formatValue(b.discount + l.discount, "pct")}`);
  if (l.spend) out.push(`marketing spend ${formatSignedPct(l.spend, 0)}`);
  if (l.delivery) out.push(`delivery ${l.delivery < 0 ? "faster" : "slower"} by ${Math.abs(l.delivery)} days`);
  if (l.retention) out.push(`a ${formatEur(l.retention)} weekly retention programme`);
  const fix = findings.find((f) => f.id === l.resolveId);
  if (l.resolve && fix) out.push(`${formatPct(l.resolve)} of the ${fix.title.toLowerCase()} recovered`);
  return out;
}

export function scenarioExplanation(model: Model, l: Levers, p: Projection, findings: Finding[]): { text: string; facts: string[] } {
  const changes = describeLevers(model, l, findings);
  const { current: c, outcome: o } = p;
  const revenue = `${formatEur(c.revenue)} to ${formatEur(o.revenue)} (${formatSignedPct(rel(o.revenue, c.revenue))})`;
  const profit = `${formatEur(c.profit)} to ${formatEur(o.profit)} (${formatSignedPct(rel(o.profit, c.profit))})`;
  const facts = [
    `Weekly revenue: ${revenue}`,
    `Weekly contribution profit after marketing: ${profit}`,
    `New customers per week: ${formatValue(c.acquisitions, "count")} to ${formatValue(o.acquisitions, "count")} (${formatSignedPct(rel(o.acquisitions, c.acquisitions))})`,
    `Repeat purchase rate: ${formatValue(c.repeatRate, "pct")} to ${formatValue(o.repeatRate, "pct")}`,
    ...changes,
  ];
  if (!changes.length) {
    return { text: `This is the current weekly run-rate: ${formatEur(c.revenue)} of revenue and ${formatEur(c.profit)} of contribution profit after marketing. Move a lever to simulate a decision.`, facts };
  }
  let text = `With ${changes.join(", ")}, the model projects weekly revenue moving from ${revenue} and contribution profit after marketing from ${profit} once the customer base has adjusted.`;
  if (p.priceSensitive) {
    const lo = rel(Math.min(p.range.inelastic.profit, p.range.elastic.profit), c.profit);
    const hi = rel(Math.max(p.range.inelastic.profit, p.range.elastic.profit), c.profit);
    const range = `Price elasticity is assumed, not measured: between ${PRICE_ELASTICITY.inelastic} and ${PRICE_ELASTICITY.elastic}, the profit effect ranges from ${formatSignedPct(lo)} to ${formatSignedPct(hi)}.`;
    text += ` ${range}`;
    facts.push(range);
  }
  if (l.retention) text += " The retention response is an assumption with no data behind it.";
  return { text, facts };
}
