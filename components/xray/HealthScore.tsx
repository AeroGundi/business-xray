"use client";

import { useState } from "react";
import type { Health, HealthComponent } from "@/types/insights";
import { formatValue } from "@/lib/format";

const fmt = (c: Pick<HealthComponent, "unit">, v: number) => formatValue(v, c.unit === "count" ? "count" : c.unit);

/**
 * The score as a 100-tick instrument scale: one tick per point, grouped into
 * the five pillars. Selecting a pillar reveals the components behind it.
 */
export function HealthScore({ health }: { health: Health }) {
  const [open, setOpen] = useState<string | null>(null);
  const pillar = health.pillars.find((p) => p.id === open) ?? null;

  return (
    <div>
      <p className="label">Business health</p>
      <p className="figure mt-3 flex items-baseline gap-3 text-[clamp(5rem,9vw,9rem)]">
        {health.score}
        <span className="text-[0.2em] tracking-normal text-ink-3">/ {health.max}</span>
      </p>

      <div className="mt-8 grid grid-cols-5 gap-3" role="group" aria-label="Score by pillar">
        {health.pillars.map((p) => {
          const filled = Math.round(p.points);
          const active = open === p.id;
          return (
            <button
              key={p.id} type="button" aria-expanded={active}
              onClick={() => setOpen(active ? null : p.id)}
              className="group pointer-events-auto flex cursor-pointer flex-col gap-2.5 text-left"
            >
              <span className="flex h-9 items-end gap-[2px]" aria-hidden>
                {Array.from({ length: p.max }, (_, i) => (
                  <span
                    key={i}
                    className="flex-1 bg-ink transition-[height,opacity] duration-700 ease-xray"
                    style={{ height: active ? "100%" : i < filled ? "62%" : "30%", opacity: i < filled ? (active || !open ? 0.95 : 0.4) : 0.16 }}
                  />
                ))}
              </span>
              <span className={`label text-[9px] tracking-[0.02em] sm:text-[10px] sm:tracking-[0.06em] transition-colors ${active ? "text-ink" : "group-hover:text-ink-2"}`}>
                <span className="block truncate">{p.label}</span>
                <span className="mt-0.5 block tracking-normal">
                  {p.points.toFixed(0)} / {p.max}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 min-h-[7.5rem]">
        {pillar ? (
          <dl key={pillar.id} className="reveal space-y-3">
            {pillar.components.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-line pt-2.5">
                <dt className="text-sm text-ink-2">{c.label}</dt>
                <dd className="text-right text-sm tabular-nums">
                  {fmt(c, c.value)}
                  <span className="ml-3 text-ink-3">
                    {c.points.toFixed(1)} / {c.max}
                  </span>
                </dd>
                <dd className="label col-span-2 mt-1 tracking-wider normal-case">
                  0 pts at {fmt(c, c.floor)} · full at {fmt(c, c.target)} · linear
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="label">Select a pillar to see what the score is made of</p>
        )}
      </div>
    </div>
  );
}
