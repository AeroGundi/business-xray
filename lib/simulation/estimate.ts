import type { Dataset } from "@/types/domain";

/**
 * Parameter estimation for the What-If model. Where the data contains
 * usable variation, a response is estimated by least squares with group
 * fixed effects; the standard error is reported with every estimate.
 */

export interface Estimate {
  value: number;
  se: number;
  n: number;
}

/** OLS slope of y on x after removing group means (one-way fixed effects). */
export function fixedEffectsSlope(rows: { x: number; y: number; group: string }[]): Estimate {
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (const r of rows) {
    const s = sums.get(r.group) ?? { x: 0, y: 0, n: 0 };
    s.x += r.x;
    s.y += r.y;
    s.n++;
    sums.set(r.group, s);
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const r of rows) {
    const s = sums.get(r.group)!;
    const dx = r.x - s.x / s.n;
    const dy = r.y - s.y / s.n;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const n = rows.length;
  const dof = n - sums.size - 1;
  if (sxx === 0 || dof <= 0) return { value: 0, se: Infinity, n };
  const value = sxy / sxx;
  const residual = Math.max(0, syy - value * sxy);
  return { value, se: Math.sqrt(residual / dof / sxx), n };
}

/**
 * Elasticity of weekly acquisitions to weekly spend for paid channels:
 * log(new customers) on log(spend), with channel fixed effects.
 */
export function estimateSpendElasticity(data: Dataset): Estimate {
  const paid = new Set(data.channels.filter((c) => c.paid).map((c) => c.id));
  const weekly = new Map<string, { spend: number; acquired: number; channel: string }>();
  for (const m of data.marketing) {
    if (!paid.has(m.channel)) continue;
    const key = `${m.channel}|${m.week}`;
    const w = weekly.get(key) ?? { spend: 0, acquired: 0, channel: m.channel };
    w.spend += m.spend;
    w.acquired += m.newCustomers;
    weekly.set(key, w);
  }
  const rows = [...weekly.values()]
    .filter((w) => w.spend > 0 && w.acquired > 0)
    .map((w) => ({ x: Math.log(w.spend), y: Math.log(w.acquired), group: w.channel }));
  return fixedEffectsSlope(rows);
}

/** Days delivered beyond the promise plus one day of grace — the same threshold as the on-time metric. */
export const lateness = (deliveryDays: number, promisedDays: number): number => Math.max(0, deliveryDays - promisedDays - 1);

/** Change in repeat-purchase probability per day late, with segment fixed effects. */
export function estimateLatenessOnRepeat(data: Dataset): Estimate {
  return fixedEffectsSlope(
    data.orders.filter((o) => o.eligible).map((o) => ({ x: lateness(o.deliveryDays, o.promisedDays), y: o.repurchased, group: o.segment })),
  );
}

/** Change in return probability per day late, with category fixed effects. */
export function estimateLatenessOnReturns(data: Dataset): Estimate {
  return fixedEffectsSlope(data.orders.map((o) => ({ x: lateness(o.deliveryDays, o.promisedDays), y: o.returned, group: o.category })));
}
