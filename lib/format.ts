import type { Unit } from "@/lib/analytics/metrics";

const nf = (digits: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** U+2212 minus so negative figures align typographically. */
const signed = (x: number, body: string): string => (x < 0 ? "−" : x > 0 ? "+" : "") + body;

export function formatValue(x: number, unit: Unit | "index"): string {
  if (!Number.isFinite(x)) return "–";
  switch (unit) {
    case "eur": return formatEur(x);
    case "pct": return `${nf(1).format(x * 100)}%`;
    case "days": return `${nf(1).format(x)} d`;
    case "index": return nf(2).format(x);
    default: return nf(Math.abs(x) < 10 && x % 1 !== 0 ? 1 : 0).format(x);
  }
}

/**
 * Display currency. Money is never converted — this is only the symbol shown,
 * set once when a dataset is loaded (the demo business reports in euros).
 */
let symbol = "€";
export const setCurrency = (s: string): void => void (symbol = s);
export const currency = (): string => symbol;

export function formatEur(x: number): string {
  const a = Math.abs(x);
  const body = a >= 1e6 ? `${symbol}${nf(2).format(a / 1e6)}M` : a >= 1e4 ? `${symbol}${nf(0).format(a / 1e3)}k` : a >= 1e3 ? `${symbol}${nf(1).format(a / 1e3)}k` : `${symbol}${nf(0).format(a)}`;
  return x < 0 ? `−${body}` : body;
}

export const formatSignedEur = (x: number): string => signed(x, formatEur(Math.abs(x)));

/** Change of a metric: percentage points for rates, relative % otherwise. */
export function formatChange(change: number, changePct: number, unit: Unit): string {
  if (unit === "pct") return `${signed(change, nf(1).format(Math.abs(change) * 100))} pts`;
  return `${signed(changePct, nf(1).format(Math.abs(changePct) * 100))}%`;
}

/** Absolute change in the metric's own unit. */
export function formatDelta(change: number, unit: Unit): string {
  if (unit === "pct") return `${signed(change, nf(1).format(Math.abs(change) * 100))} pts`;
  if (unit === "eur") return formatSignedEur(change);
  if (unit === "days") return `${signed(change, nf(1).format(Math.abs(change)))} d`;
  return signed(change, nf(Math.abs(change) < 10 ? 1 : 0).format(Math.abs(change)));
}

export const formatPct = (x: number, digits = 0): string => `${nf(digits).format(x * 100)}%`;

export const formatSignedPct = (x: number, digits = 1): string => `${signed(x, nf(digits).format(Math.abs(x) * 100))}%`;

export function formatP(p: number): string {
  return p < 0.001 ? "p < 0.001" : `p = ${nf(3).format(p)}`;
}

/** ISO date of the Monday starting `week`. */
export function weekDate(startDate: string, week: number): Date {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + week * 7);
  return d;
}

export function formatWeek(startDate: string, week: number): string {
  return weekDate(startDate, week).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
