/** Small, dependency-free statistics toolkit used by every analytical module. */

export const sum = (xs: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
};

export const mean = (xs: ArrayLike<number>): number => (xs.length ? sum(xs) / xs.length : 0);

export function variance(xs: ArrayLike<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return s / (xs.length - 1);
}

export function median(xs: ArrayLike<number>): number {
  if (!xs.length) return 0;
  const s = Array.from(xs).sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation scaled to be a consistent estimator of σ. */
export function mad(xs: ArrayLike<number>): number {
  const m = median(xs);
  return 1.4826 * median(Array.from(xs, (x) => Math.abs(x - m)));
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Two-sided p-value of a z statistic. */
export const pValue = (z: number): number => 2 * (1 - normalCdf(Math.abs(z)));

export interface Moments {
  n: number;
  mean: number;
  variance: number;
  /** Every observation was 0 or 1. */
  binary: boolean;
}

/** Streaming accumulator of count, mean and sample variance. */
export class Accumulator {
  n = 0;
  private s = 0;
  private ss = 0;
  private binary = true;
  add(x: number): void {
    this.n++;
    this.s += x;
    this.ss += x * x;
    if (x !== 0 && x !== 1) this.binary = false;
  }
  get moments(): Moments {
    const m = this.n ? this.s / this.n : 0;
    return { n: this.n, mean: m, variance: this.n > 1 ? Math.max(0, (this.ss - this.n * m * m) / (this.n - 1)) : 0, binary: this.binary };
  }
}

export interface TestResult {
  /** Difference of means, a − b. */
  diff: number;
  statistic: number;
  p: number;
}

/**
 * Two-sample test of a difference in means.
 *  - Binary outcomes: two-proportion z-test with pooled variance.
 *  - Otherwise: Welch's unequal-variance t-test. Sample sizes are large
 *    enough that the t distribution is approximated by the normal.
 */
export function meanDifferenceTest(a: Moments, b: Moments): TestResult {
  const diff = a.mean - b.mean;
  if (a.n < 2 || b.n < 2) return { diff, statistic: 0, p: 1 };
  let se: number;
  if (a.binary && b.binary) {
    const pooled = (a.mean * a.n + b.mean * b.n) / (a.n + b.n);
    se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  } else {
    se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  }
  if (se === 0) return { diff, statistic: 0, p: 1 };
  const statistic = diff / se;
  return { diff, statistic, p: pValue(statistic) };
}

export interface Correlation {
  r: number;
  n: number;
  p: number;
}

/** Pearson correlation with a Fisher-z significance test. */
export function pearson(xs: ArrayLike<number>, ys: ArrayLike<number>): Correlation {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return { r: 0, n, p: 1 };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { r: 0, n, p: 1 };
  const r = Math.max(-0.999999, Math.min(0.999999, sxy / Math.sqrt(sxx * syy)));
  return { r, n, p: pValue(Math.atanh(r) * Math.sqrt(n - 3)) };
}

/** Ordinary least-squares slope and intercept of ys over 0..n−1. */
export function linearTrend(ys: ArrayLike<number>): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (ys[i] - my);
    sxx += (i - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
