import type { Periods, Unit } from "@/lib/analytics/metrics";
import { mean } from "@/lib/analytics/stats";
import { formatValue } from "@/lib/format";

interface Props {
  values: number[];
  periods: Periods;
  unit: Unit;
  label: string;
}

const W = 320;
const H = 96;

/** Weekly trace with the two comparison periods and their means marked. */
export function Sparkline({ values, periods, unit, label }: Props) {
  const end = periods.recent.to;
  const pts = values.slice(0, end).map((v, i) => ({ i, v })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => (hi === lo ? H / 2 : H - 6 - ((v - lo) / (hi - lo)) * (H - 12));
  const path = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const avg = (from: number, to: number) => mean(pts.filter((p) => p.i >= from && p.i < to).map((p) => p.v));
  const b = avg(periods.baseline.from, periods.baseline.to);
  const r = avg(periods.recent.from, periods.recent.to);

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={`${label}, weekly. Baseline average ${formatValue(b, unit)}, recent average ${formatValue(r, unit)}.`}>
        <rect x={x(periods.baseline.from)} width={x(periods.baseline.to) - x(periods.baseline.from)} y={0} height={H} fill="var(--ink)" opacity={0.045} />
        <rect x={x(periods.recent.from)} width={x(end - 1) - x(periods.recent.from)} y={0} height={H} fill="var(--tone, var(--ink))" opacity={0.13} />
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1} opacity={0.75} vectorEffect="non-scaling-stroke" />
        <line x1={x(periods.baseline.from)} x2={x(periods.baseline.to)} y1={y(b)} y2={y(b)} stroke="var(--ink)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <line x1={x(periods.recent.from)} x2={x(end - 1)} y1={y(r)} y2={y(r)} stroke="var(--tone, var(--ink))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="label mt-2 flex justify-between">
        <span>{values.length} weeks</span>
        <span>
          {formatValue(lo, unit)} – {formatValue(hi, unit)}
        </span>
      </figcaption>
    </figure>
  );
}
