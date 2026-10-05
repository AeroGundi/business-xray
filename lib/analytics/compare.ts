import type { Dataset } from "@/types/domain";
import { type Agg, type DimKey, type FactRow, type Metric, type Periods, type Scope, dimOf, emptyAgg, inScope, rowsOf, span, valueOf } from "./metrics";

/**
 * A comparison contrasts a focus set A against a reference set B.
 *  - "time":  A = scope in the recent period, B = same scope in the baseline period.
 *  - "peers": A = scope, B = the same scope for every other member of `peerDim`,
 *             both over baseline + recent weeks.
 */
export type Comparison =
  | { kind: "time"; periods: Periods }
  | { kind: "peers"; periods: Periods; peerDim: DimKey };

export interface Pair {
  a: Agg;
  b: Agg;
}

export interface Effect {
  before: number;
  after: number;
  /** after − before, in metric units. */
  change: number;
  /** Relative change; 0 when the reference is 0. */
  changePct: number;
  /** Fact rows in A and B. */
  n: number;
}

export interface MemberEffect extends Effect {
  member: string;
  /** Additive contribution to the total change (sums to it across members). */
  contribution: number;
  /** contribution / total change. Positive = moves with the total. */
  share: number;
  /** Member's share of the reference volume. */
  weight: number;
  /** Relative change of all other members combined. */
  restChangePct: number;
}

export interface Split {
  dim: DimKey;
  total: Effect;
  members: MemberEffect[];
}

export function weeksOf(c: Comparison): { a: number; b: number } {
  if (c.kind === "time") return { a: span(c.periods.recent), b: span(c.periods.baseline) };
  const w = c.periods.recent.to - c.periods.baseline.from;
  return { a: w, b: w };
}

/** Classifies a row as focus ("a"), reference ("b") or outside the comparison. */
export function sideOf(row: FactRow, scope: Scope, c: Comparison): "a" | "b" | null {
  const w = row.week;
  if (c.kind === "time") {
    if (!inScope(row, scope)) return null;
    if (w >= c.periods.recent.from && w < c.periods.recent.to) return "a";
    if (w >= c.periods.baseline.from && w < c.periods.baseline.to) return "b";
    return null;
  }
  if (w < c.periods.baseline.from || w >= c.periods.recent.to) return null;
  const focus = scope[c.peerDim];
  for (const k in scope) {
    if (k !== c.peerDim && dimOf(row, k as DimKey) !== scope[k as DimKey]) return null;
  }
  return dimOf(row, c.peerDim) === focus ? "a" : "b";
}

/** Aggregates A and B, optionally broken down by one dimension. */
export function aggregatePairs(data: Dataset, metric: Metric, scope: Scope, c: Comparison, dim?: DimKey): { total: Pair; byMember: Map<string, Pair> } {
  const total: Pair = { a: emptyAgg(), b: emptyAgg() };
  const byMember = new Map<string, Pair>();
  const num = metric.num as (r: FactRow) => number;
  const den = metric.den as ((r: FactRow) => number) | undefined;
  for (const row of rowsOf(data, metric.source)) {
    const side = sideOf(row, scope, c);
    if (!side) continue;
    const n = num(row);
    const d = den ? den(row) : 1;
    const t = total[side];
    t.num += n;
    t.den += d;
    t.n++;
    if (dim) {
      const key = dimOf(row, dim);
      let p = byMember.get(key);
      if (!p) byMember.set(key, (p = { a: emptyAgg(), b: emptyAgg() }));
      const m = p[side];
      m.num += n;
      m.den += d;
      m.n++;
    }
  }
  return { total, byMember };
}

export function effectOf(metric: Metric, pair: Pair, c: Comparison): Effect {
  const w = weeksOf(c);
  const before = valueOf(metric, pair.b, w.b);
  const after = valueOf(metric, pair.a, w.a);
  return { before, after, change: after - before, changePct: before !== 0 ? (after - before) / Math.abs(before) : 0, n: pair.a.n + pair.b.n };
}

/**
 * Exact additive contribution of a member to the change of the total.
 *
 * Sum metric:   cᵢ = aᵢ/wA − bᵢ/wB
 * Ratio metric: cᵢ = (numAᵢ − ρB·denAᵢ)/DenA − (numBᵢ − ρB·denBᵢ)/DenB,   ρB = NumB/DenB
 *
 * In both cases Σᵢ cᵢ equals the change of the total, and the ratio form
 * captures rate and mix effects together.
 */
export function contributionOf(metric: Metric, member: Pair, total: Pair, c: Comparison): number {
  const w = weeksOf(c);
  if (!metric.den) return member.a.num / w.a - member.b.num / w.b;
  if (total.a.den <= 0 || total.b.den <= 0) return 0;
  const rho = total.b.num / total.b.den;
  return (member.a.num - rho * member.a.den) / total.a.den - (member.b.num - rho * member.b.den) / total.b.den;
}

const minus = (x: Agg, y: Agg): Agg => ({ num: x.num - y.num, den: x.den - y.den, n: x.n - y.n });

/** Contribution analysis of a metric change across the members of one dimension. */
export function splitBy(data: Dataset, metric: Metric, scope: Scope, c: Comparison, dim: DimKey): Split {
  const { total, byMember } = aggregatePairs(data, metric, scope, c, dim);
  const totalEffect = effectOf(metric, total, c);
  const refVolume = metric.den ? total.b.den : total.b.num;
  const members: MemberEffect[] = [];
  for (const [member, pair] of byMember) {
    const contribution = contributionOf(metric, pair, total, c);
    const rest: Pair = { a: minus(total.a, pair.a), b: minus(total.b, pair.b) };
    members.push({
      member,
      ...effectOf(metric, pair, c),
      contribution,
      share: totalEffect.change !== 0 ? contribution / totalEffect.change : 0,
      weight: refVolume > 0 ? (metric.den ? pair.b.den : pair.b.num) / refVolume : 0,
      restChangePct: effectOf(metric, rest, c).changePct,
    });
  }
  members.sort((x, y) => y.share - x.share);
  return { dim, total: totalEffect, members };
}
