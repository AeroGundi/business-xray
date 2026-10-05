"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEur, formatSignedEur, formatSignedPct } from "@/lib/format";
import { checkpoints, decisionBrief, evaluate, exportBrief, recommend } from "@/lib/simulation/decision";
import { type Model, sameLevers } from "@/lib/simulation/model";
import { useXray } from "@/store/useXray";
import { sourceLabel, useExplanation } from "./useExplanation";

const rel = (after: number, before: number) => (before !== 0 ? after / before - 1 : 0);
const pct = (x: number) => (Math.abs(x) < 0.0005 ? "—" : formatSignedPct(x));

/** The closing chapter: options side by side on expected and pessimistic profit, and a brief for the one chosen. */
export function Decision({ model }: { model: Model }) {
  const scenarios = useXray((s) => s.scenarios);
  const findings = useXray((s) => s.findings);
  const levers = useXray((s) => s.levers);
  const { setLevers, backToWhatIf, restart } = useXray.getState();
  const [copied, setCopied] = useState(false);

  const options = useMemo(() => evaluate(model, scenarios, findings), [model, scenarios, findings]);
  const ranked = useMemo(() => [...options].sort((a, b) => b.worst.profit - a.worst.profit), [options]);
  const robust = recommend(options);
  const chosen = options.find((o) => sameLevers(o.scenario.levers, levers)) ?? robust;
  const brief = decisionBrief(model, chosen, options, findings);
  const explanation = useExplanation({ topic: "Decision brief for a simulated business scenario", draft: brief.statement, facts: brief.facts });
  const watch = checkpoints(model, chosen);
  const assumed = chosen.depends.filter((p) => p.source === "assumed");
  const estimated = chosen.depends.filter((p) => p.source === "estimated");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && backToWhatIf();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backToWhatIf]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportBrief(model, chosen, options, findings));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="stage-grid">
      <div className="stage-col">
        <button type="button" onClick={backToWhatIf} className="label pointer-events-auto mb-6 cursor-pointer self-start transition-colors hover:text-ink">
          ← What if?
        </button>
        <h2 className="display text-[clamp(2rem,3.2vw,3.2rem)]">Decision</h2>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Options ranked by their pessimistic case: the worst profit across every plausible value of the parameters each one depends on.
        </p>

        <div className="mt-6 grid grid-cols-[1fr_auto_auto] gap-x-5">
          <span className="label pb-2">Option</span>
          <span className="label pb-2 text-right">Expected</span>
          <span className="label pb-2 text-right">Pessimistic</span>
          {ranked.map((o) => {
            const active = o === chosen;
            return (
              <button
                key={o.scenario.id} type="button" aria-pressed={active} onClick={() => setLevers(o.scenario.levers)}
                className={`pointer-events-auto col-span-3 grid cursor-pointer grid-cols-subgrid items-baseline border-t border-line py-2.5 text-left text-sm transition-colors hover:text-ink ${active ? "text-ink" : "text-ink-3"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate" title={o.scenario.name}>{o.scenario.name}</span>
                  {o === robust && <span className="label mt-1 block tracking-wider text-ink-2">Most robust</span>}
                </span>
                <span className="text-right tabular-nums">{pct(rel(o.expected.profit, o.current.profit))}</span>
                <span className="text-right tabular-nums" style={active ? { color: o.worst.profit >= o.current.profit ? "var(--positive)" : "var(--risk)" } : undefined}>
                  {pct(rel(o.worst.profit, o.current.profit))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="label mt-3 tracking-wider normal-case">Change in weekly contribution profit after marketing. Select an option to read its brief.</p>
      </div>

      <div aria-hidden className="max-lg:hidden" />

      <div className="stage-col">
        <div key={chosen.scenario.id} className="reveal">
          <p className="label text-ink-2">Decision brief</p>
          <h3 className="display mt-3 text-[clamp(1.5rem,2.1vw,2.1rem)] leading-[1.05]">{chosen.scenario.name}</h3>
          <p className="mt-4 text-sm leading-relaxed text-ink-2">{explanation.text}</p>
          <p className="label mt-2 tracking-wider normal-case">{sourceLabel(explanation)}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
            <div className="border-t border-line pt-2.5">
              <dt className="label">Expected profit</dt>
              <dd className="mt-1 text-[0.95rem] tabular-nums tracking-tight">
                {formatEur(chosen.expected.profit)} <span className="text-ink-3">/ week</span>
              </dd>
            </div>
            <div className="border-t border-line pt-2.5">
              <dt className="label">Per year</dt>
              <dd className="mt-1 text-[0.95rem] tabular-nums tracking-tight">{formatSignedEur((chosen.expected.profit - chosen.current.profit) * 52)}</dd>
            </div>
            <div className="col-span-2 border-t border-line pt-2.5">
              <dt className="label">{chosen.cases > 1 ? `Range across ${chosen.cases} parameter combinations` : "Range"}</dt>
              <dd className="mt-1 text-[0.95rem] tabular-nums tracking-tight">
                {chosen.cases > 1
                  ? `${pct(rel(chosen.worst.profit, chosen.current.profit))} to ${pct(rel(chosen.best.profit, chosen.current.profit))}`
                  : "No uncertainty to model"}
              </dd>
            </div>
            <div className="col-span-2 border-t border-line pt-2.5">
              <dt className="label">Rests on</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-2">
                {chosen.depends.length === 0 && !chosen.resolves && "Nothing changes, so no model parameter is involved."}
                {estimated.length > 0 && <span className="block">Estimated from data: {estimated.map((p) => p.label.toLowerCase()).join("; ")}.</span>}
                {assumed.length > 0 && <span className="block text-ink">Assumed: {assumed.map((p) => p.label.toLowerCase()).join("; ")}.</span>}
                {chosen.resolves && <span className="block text-ink">Assumed: “{chosen.resolves.title}” returns to its baseline.</span>}
              </dd>
            </div>
          </dl>

          <p className="label mt-6">Watch after acting</p>
          <ul className="mt-2">
            {watch.map((k) => (
              <li key={k.label} className="flex items-baseline justify-between gap-4 border-t border-line py-2 text-sm">
                <span className="min-w-0 truncate text-ink-2">{k.label}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {k.current} → {k.expected}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-x-7">
            <button type="button" className="command pointer-events-auto" onClick={copy}>
              <span aria-live="polite">{copied ? "Copied" : "Copy brief"}</span>
            </button>
            <button type="button" className="command pointer-events-auto" data-quiet onClick={restart}>
              Start over
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
