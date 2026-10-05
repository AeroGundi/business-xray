"use client";

import type { Finding } from "@/types/insights";
import { METRICS } from "@/lib/analytics/metrics";
import { formatChange, formatPct } from "@/lib/format";
import { scopeLabel } from "@/lib/insights/narrative";
import { ToneMark } from "@/components/ui/ToneMark";
import { useXray } from "@/store/useXray";

export function FindingsList({ findings }: { findings: Finding[] }) {
  const open = useXray((s) => s.open);
  const hover = useXray((s) => s.hover);
  const hoverId = useXray((s) => s.hoverId);

  return (
    <div>
      <h2 className="display text-[clamp(1.7rem,2.5vw,2.5rem)] leading-[1.02]">
        {findings.length} things worth investigating
      </h2>
      <ol className="reveal mt-7" onMouseLeave={() => hover(null)}>
        {findings.map((f) => {
          const metric = METRICS[f.metric];
          const dimmed = hoverId !== null && hoverId !== f.id;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => open(f.id)}
                onMouseEnter={() => hover(f.id)}
                onFocus={() => hover(f.id)}
                onBlur={() => hover(null)}
                className={`tone-${f.tone} pointer-events-auto grid w-full cursor-pointer grid-cols-[2.2rem_1fr_auto] items-baseline gap-x-2 border-t border-line py-3.5 text-left transition-opacity duration-500 ${dimmed ? "opacity-35" : ""}`}
              >
                <span className="label">{String(f.index).padStart(2, "0")}</span>
                <span>
                  <span className="block text-[1.05rem] tracking-tight">{f.title}</span>
                  <span className="mt-1 block text-[0.8rem] leading-snug text-ink-3">{scopeLabel(f.investigation.leafScope)}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="flex items-center gap-2 text-[1.05rem] tabular-nums tracking-tight" style={{ color: "var(--tone)" }}>
                    {formatChange(f.effect.change, f.effect.changePct, metric.unit)}
                    <ToneMark tone={f.tone} />
                  </span>
                  <span className="text-[0.8rem] tabular-nums text-ink-3">{formatPct(f.confidence)} confidence</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
