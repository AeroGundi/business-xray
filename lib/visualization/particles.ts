import type { Dataset, OrderRow } from "@/types/domain";
import { METRICS, periodsFor } from "@/lib/analytics/metrics";
import { Rng } from "@/lib/data/rng";

/**
 * One particle = one order from the baseline or recent period. Baseline
 * orders render as faint "ghosts": a cluster that has lost volume looks
 * hollow, which is the X-ray reading of a decline.
 */
export interface ParticleSet {
  count: number;
  rows: OrderRow[];
  /** 1 when the order belongs to the baseline period. */
  ghost: Float32Array;
  /** Unit-gaussian offset per particle (xyz), fixed for the session. */
  gauss: Float32Array;
  /** Uniform random per particle, used for phase and stagger. */
  seed: Float32Array;
  /** Point size, proportional to √revenue. */
  size: Float32Array;
  weeks: { from: number; split: number; to: number };
}

export function buildParticles(data: Dataset, max: number): ParticleSet {
  const { baseline, recent } = periodsFor(METRICS.revenue, data.weeks);
  const pool = data.orders.filter((o) => o.week >= baseline.from);
  const stride = Math.max(1, pool.length / max);
  const rows: OrderRow[] = [];
  for (let i = 0; i < pool.length; i += stride) rows.push(pool[Math.floor(i)]);

  const n = rows.length;
  const rng = new Rng(data.seed + 1);
  const ghost = new Float32Array(n);
  const gauss = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ghost[i] = rows[i].week < recent.from ? 1 : 0;
    gauss[i * 3] = rng.normal();
    gauss[i * 3 + 1] = rng.normal();
    gauss[i * 3 + 2] = rng.normal();
    seed[i] = rng.next();
    size[i] = Math.min(2.6, 0.55 + Math.sqrt(rows[i].revenue) / 16);
  }
  return { count: n, rows, ghost, gauss, seed, size, weeks: { from: baseline.from, split: recent.from, to: recent.to } };
}
