"use client";

import { useEffect } from "react";
import { formatEur, formatPct, formatSignedPct, formatValue } from "@/lib/format";
import { type Levers, type Model, NO_CHANGE, type Parameter, project, type Projection, sameLevers } from "@/lib/simulation/model";
import { scenarioExplanation } from "@/lib/simulation/narrative";
import { useXray } from "@/store/useXray";
import { sourceLabel, useExplanation } from "./useExplanation";

const rel = (after: number, before: number) => (before !== 0 ? after / before - 1 : 0);

interface LeverSpec {
  id: "price" | "discount" | "spend" | "delivery" | "retention";
  label: string;
  min: number;
  max: number;
  step: number;
  /** The setting in business terms. */
  show: (v: number, m: Model) => string;
}

const LEVERS: LeverSpec[] = [
  { id: "price", label: "Price", min: -0.15, max: 0.15, step: 0.01, show: (v, m) => `${formatSignedPct(v, 0)} · ${formatEur(m.baseline.listPerOrder * (1 + v))} per order` },
  { id: "discount", label: "Discount depth", min: -0.06, max: 0.15, step: 0.005, show: (v, m) => formatValue(m.baseline.discount + v, "pct") },
  { id: "spend", label: "Marketing spend", min: -0.5, max: 1, step: 0.05, show: (v, m) => `${formatEur(m.baseline.spend * (1 + v))} / week` },
  { id: "delivery", label: "Delivery time", min: -2, max: 4, step: 0.5, show: (v, m) => formatValue(m.baseline.deliveryDays + v, "days") },
  { id: "retention", label: "Retention programme", min: 0, max: 12000, step: 500, show: (v) => `${formatEur(v)} / week` },
];

function Lever({ spec, model, value, onChange }: { spec: LeverSpec; model: Model; value: number; onChange: (v: number) => void }) {
  // Position of "today" on the track, so a moved lever is read against it.
  const origin = ((0 - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`lever-${spec.id}`} className="label">{spec.label}</label>
        <output htmlFor={`lever-${spec.id}`} className={`text-sm tabular-nums tracking-tight ${value === 0 ? "text-ink-2" : "text-ink"}`}>
          {spec.show(value, model)}
        </output>
      </div>
      <div className="relative">
        <span aria-hidden className="absolute top-[7px] h-2 w-px bg-ink-3" style={{ left: `${origin}%` }} />
        <input
          id={`lever-${spec.id}`} type="range" className="lever pointer-events-auto" min={spec.min} max={spec.max} step={spec.step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)}
          aria-valuetext={spec.show(value, model)}
        />
      </div>
    </div>
  );
}

function Outcome({ label, change, good, before, after, range }: { label: string; change: string; good: boolean | null; before: string; after: string; range?: string }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="label">{label}</p>
      <p className="figure mt-2 text-[clamp(2rem,3.4vw,3.4rem)]" style={{ color: good === null ? "var(--ink)" : good ? "var(--positive)" : "var(--risk)" }}>
        {change}
      </p>
      <p className="mt-2 text-[0.8rem] tabular-nums text-ink-2">
        {before} → {after}
      </p>
      {range && <p className="label mt-1 tracking-wider normal-case">{range}</p>}
    </div>
  );
}

function ParameterRow({ p }: { p: Parameter }) {
  const value = Math.abs(p.value) < 0.05 ? `${(p.value * 100).toFixed(2)} pts` : p.value.toFixed(2);
  return (
    <li className="border-t border-line py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{p.label}</span>
        <span className="whitespace-nowrap tabular-nums">
          {value}
          {p.se !== undefined && <span className="text-ink-3"> ± {Math.abs(p.value) < 0.05 ? (p.se * 100).toFixed(2) : p.se.toFixed(2)}</span>}
        </span>
      </div>
      <p className="label mt-1 tracking-wider normal-case">
        <span className="uppercase tracking-[0.14em] text-ink-2">{p.source}</span> · {p.note}
      </p>
    </li>
  );
}

export function WhatIf({ model, projection }: { model: Model; projection: Projection }) {
  const levers = useXray((s) => s.levers);
  const scenarios = useXray((s) => s.scenarios);
  const findings = useXray((s) => s.findings);
  const { setLevers, pinScenario, close, openDecision } = useXray.getState();
  const { current: c, outcome: o } = projection;
  const changed = !sameLevers(levers, NO_CHANGE);
  const known = scenarios.some((s) => sameLevers(s.levers, levers));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const { text, facts } = scenarioExplanation(model, levers, projection, findings);
  const explanation = useExplanation({ topic: "Interpretation of a simulated business scenario", draft: text, facts });
  const sign = (x: number) => (Math.abs(x) < 0.0005 ? null : x > 0);
  const band = (pick: (p: Projection["outcome"]) => number, base: number) => {
    const a = rel(pick(projection.range.inelastic), base);
    const b = rel(pick(projection.range.elastic), base);
    return `${formatSignedPct(Math.min(a, b))} to ${formatSignedPct(Math.max(a, b))} across price assumptions`;
  };
  const fix = model.resolvable.find((r) => r.id === levers.resolveId) ?? model.resolvable[0];

  return (
    <section className="stage-grid">
      <div className="stage-col">
        <button type="button" onClick={close} className="label pointer-events-auto mb-6 cursor-pointer self-start transition-colors hover:text-ink">
          ← Overview
        </button>
        <h2 className="display text-[clamp(2rem,3.2vw,3.2rem)]">What if?</h2>

        <ul className="mt-6" aria-label="Scenarios">
          {scenarios.map((s, i) => {
            const active = sameLevers(s.levers, levers);
            const p = project(model, s.levers);
            const d = rel(p.outcome.profit, p.current.profit);
            return (
              <li key={s.id}>
                <button
                  type="button" aria-pressed={active} onClick={() => setLevers(s.levers)}
                  className={`pointer-events-auto flex w-full cursor-pointer items-baseline gap-3 py-1.5 text-left text-sm transition-colors hover:text-ink ${active ? "text-ink" : "text-ink-3"}`}
                >
                  <span className="label w-4 shrink-0">{String.fromCharCode(65 + i)}</span>
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto whitespace-nowrap tabular-nums">{Math.abs(d) < 0.0005 ? "—" : `${formatSignedPct(d)} profit`}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 space-y-3.5">
          {LEVERS.map((spec) => (
            <Lever key={spec.id} spec={spec} model={model} value={levers[spec.id]} onChange={(v) => setLevers({ [spec.id]: v } as Partial<Levers>)} />
          ))}
          {fix && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="lever-resolve" className="label">Resolve</label>
                <select
                  value={fix.id} onChange={(e) => setLevers({ resolveId: e.target.value as Levers["resolveId"] })} aria-label="Finding to resolve"
                  className="pointer-events-auto min-w-0 cursor-pointer truncate bg-transparent text-right text-sm text-ink-2 outline-none"
                >
                  {model.resolvable.map((r) => (
                    <option key={r.id} value={r.id} className="bg-raised">{r.title}</option>
                  ))}
                </select>
                <output className={`w-10 shrink-0 text-right text-sm tabular-nums ${levers.resolve ? "text-ink" : "text-ink-2"}`}>{formatPct(levers.resolve)}</output>
              </div>
              <input
                id="lever-resolve" type="range" className="lever pointer-events-auto" min={0} max={1} step={0.1} value={levers.resolve}
                onChange={(e) => setLevers({ resolve: Number(e.target.value), resolveId: fix.id })}
                aria-valuetext={`${formatPct(levers.resolve)} of ${fix.title} recovered`}
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-7">
          <button type="button" className="command pointer-events-auto" onClick={openDecision}>
            Decide <span aria-hidden>→</span>
          </button>
          <button type="button" data-quiet className="command pointer-events-auto disabled:cursor-default disabled:opacity-35" onClick={pinScenario} disabled={!changed || known}>
            Keep scenario
          </button>
          <button type="button" className="command pointer-events-auto disabled:cursor-default disabled:opacity-35" data-quiet onClick={() => setLevers(NO_CHANGE)} disabled={!changed}>
            Reset
          </button>
        </div>
      </div>

      <div aria-hidden className="max-lg:hidden" />

      <div className="stage-col">
        <p className="label text-ink-2">Projected weekly run-rate</p>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
          <Outcome label="Revenue" change={formatSignedPct(rel(o.revenue, c.revenue))} good={sign(o.revenue - c.revenue)} before={formatEur(c.revenue)} after={formatEur(o.revenue)}
            range={projection.priceSensitive ? band((x) => x.revenue, c.revenue) : undefined} />
          <Outcome label="Profit" change={formatSignedPct(rel(o.profit, c.profit))} good={sign(o.profit - c.profit)} before={formatEur(c.profit)} after={formatEur(o.profit)}
            range={projection.priceSensitive ? band((x) => x.profit, c.profit) : undefined} />
          <Outcome label="New customers" change={formatSignedPct(rel(o.acquisitions, c.acquisitions))} good={sign(o.acquisitions - c.acquisitions)}
            before={formatValue(c.acquisitions, "count")} after={formatValue(o.acquisitions, "count")} />
          <Outcome label="Repeat rate" change={`${o.repeatRate >= c.repeatRate ? "+" : "−"}${Math.abs((o.repeatRate - c.repeatRate) * 100).toFixed(1)} pts`} good={sign(o.repeatRate - c.repeatRate)}
            before={formatValue(c.repeatRate, "pct")} after={formatValue(o.repeatRate, "pct")} />
        </div>

        <p className="mt-6 text-sm leading-relaxed text-ink-2">{explanation.text}</p>
        <p className="label mt-3 tracking-wider normal-case">{sourceLabel(explanation)}</p>

        <details className="pointer-events-auto mt-5">
          <summary className="label cursor-pointer text-ink-2 transition-colors hover:text-ink">Model and assumptions</summary>
          <ul className="mt-3">
            {Object.values(model.params).map((p) => (
              <ParameterRow key={p.id} p={p} />
            ))}
          </ul>
          <p className="label mt-3 tracking-wider normal-case">
            Steady-state comparison of weekly run-rates, calibrated on the last {model.baseline.weeks} weeks. Not a forecast. Profit is contribution profit after marketing spend.
          </p>
        </details>
      </div>
    </section>
  );
}
