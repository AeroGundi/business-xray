"use client";

import { useEffect, useState } from "react";
import type { Finding } from "@/types/insights";
import { DIM_LABEL, METRICS, type Metric } from "@/lib/analytics/metrics";
import { formatChange, formatDelta, formatEur, formatP, formatPct, formatSignedEur, formatSignedPct, formatValue } from "@/lib/format";
import { type HypothesisResult, openHypotheses, testHypothesis } from "@/lib/insights/hypotheses";
import { CAVEAT, causeStatement, detectionSentence, nextQuestion, periodText, scopeLabel } from "@/lib/insights/narrative";
import { stagesOf, type Stage } from "@/lib/visualization/view";
import { Sparkline } from "@/components/ui/Sparkline";
import { ToneMark, toneName } from "@/components/ui/ToneMark";
import { canSimulate } from "@/lib/simulation/model";
import { useXray } from "@/store/useXray";
import { sourceLabel, useExplanation } from "./useExplanation";

const pad = (n: number) => String(n).padStart(2, "0");
const share = (x: number) => formatPct(Math.min(1, Math.max(0, x)));

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2.5">
      <dt className="label">{term}</dt>
      <dd className="mt-1 text-[0.95rem] tabular-nums tracking-tight">{children}</dd>
    </div>
  );
}

/** One line of the path already travelled. */
function crumb(f: Finding, stage: Stage): { name: string; value: string } {
  const metric: Metric = METRICS[f.metric];
  if (stage.kind === "metric") {
    const where = Object.keys(f.scope).length ? ` · ${scopeLabel(f.scope)}` : "";
    return { name: `${metric.label}${where}`, value: formatChange(f.effect.change, f.effect.changePct, metric.unit) };
  }
  if (stage.kind === "segment") {
    const step = f.investigation.steps[stage.step!];
    return { name: step.member, value: formatChange(step.effect.change, step.effect.changePct, metric.unit) };
  }
  const lead = f.investigation.drivers[0];
  if (stage.kind === "cause") {
    return lead
      ? { name: METRICS[lead.metric].label, value: formatDelta(lead.change, METRICS[lead.metric].unit) }
      : { name: "No clear driver", value: "" };
  }
  return { name: "Impact", value: "" };
}

function Headline({ f, stage }: { f: Finding; stage: Stage }) {
  const metric: Metric = METRICS[f.metric];
  const inv = f.investigation;
  const tone = { color: "var(--tone)" };

  if (stage.kind === "metric") {
    const scoped = Object.keys(f.scope).length > 0;
    return (
      <>
        {f.question && (
          <p className="mb-6 text-sm leading-snug text-ink-2">
            <span className="label mb-1.5 block">You asked</span>“{f.question}”
            <span className="label mt-2 block tracking-wider normal-case">{f.interpretation}</span>
          </p>
        )}
        <p className="label">What changed?</p>
        <h2 className="display mt-4 text-[clamp(2rem,3.5vw,3.6rem)]">
          {metric.label}
          {scoped && <span className="mt-2 block text-[0.5em] tracking-tight text-ink-2">{scopeLabel(f.scope)}</span>}
        </h2>
        <p className="figure mt-5 text-[clamp(3.6rem,7vw,7rem)]" style={tone}>{formatChange(f.effect.change, f.effect.changePct, metric.unit)}</p>
        <p className="mt-4 text-sm text-ink-2">
          {formatValue(f.effect.before, metric.unit)} → {formatValue(f.effect.after, metric.unit)}
          {!metric.den && " per week"} · {periodText(f)}
        </p>
      </>
    );
  }

  if (stage.kind === "segment") {
    const step = inv.steps[stage.step!];
    return (
      <>
        <p className="label">{nextQuestion(step.dim)}</p>
        <h2 className="display mt-4 text-[clamp(2rem,3.5vw,3.6rem)]">{step.member}</h2>
        <p className="figure mt-5 text-[clamp(3.6rem,7vw,7rem)]" style={tone}>{formatChange(step.effect.change, step.effect.changePct, metric.unit)}</p>
        <p className="mt-4 text-sm text-ink-2">
          Accounts for {share(step.share)} of the change above, from {share(step.weight)} of its volume.
        </p>
      </>
    );
  }

  if (stage.kind === "cause") {
    const lead = inv.drivers[0];
    const lm: Metric | null = lead ? METRICS[lead.metric] : null;
    return (
      <>
        <p className="label">Why? — likely contributor</p>
        <h2 className="display mt-4 text-[clamp(2rem,3.5vw,3.6rem)]">{lm ? lm.label : "No clear driver"}</h2>
        {lead && lm && (
          <p className="figure mt-5 text-[clamp(3.2rem,6vw,6rem)]" style={tone}>{formatDelta(lead.change, lm.unit)}</p>
        )}
        <CauseExplanation f={f} />
      </>
    );
  }

  const impact = inv.impact;
  return (
    <>
      <p className="label">How important is it?</p>
      <h2 className="display mt-4 text-[clamp(2rem,3.5vw,3.6rem)]">{impact.label}</h2>
      <p className="figure mt-5 text-[clamp(3.6rem,7vw,7rem)]" style={tone}>
        {impact.unit === "eur" ? formatSignedEur(impact.value) : Math.abs(impact.value).toLocaleString("en-GB")}
      </p>
      <p className="mt-4 text-sm text-ink-2">
        Estimated over {impact.weeks} weeks
        {impact.annualised !== null && <> · {formatSignedEur(impact.annualised)} a year if it persists</>}
      </p>
    </>
  );
}

/** The root-cause statement, optionally reworded by a language model within the grounding check. */
function CauseExplanation({ f }: { f: Finding }) {
  const inv = f.investigation;
  const facts = [
    detectionSentence(f),
    scopeLabel(inv.leafScope),
    ...inv.drivers.map((d) => {
      const m = METRICS[d.metric];
      return `${m.label}: ${formatValue(d.before, m.unit)} to ${formatValue(d.after, m.unit)}, change ${formatDelta(d.change, m.unit)}, ${formatP(d.p)}`;
    }),
  ];
  const explanation = useExplanation({ topic: `Likely contributor to the change in ${METRICS[f.metric].noun}`, draft: causeStatement(f), facts });
  return (
    <>
      <p className="mt-5 max-w-[34ch] text-[0.98rem] leading-relaxed text-ink-2">{explanation.text}</p>
      <p className="label mt-3 tracking-wider normal-case">{sourceLabel(explanation)}</p>
    </>
  );
}

/** Hypotheses the engine has not already confirmed; each is tested on demand. */
function Hypotheses({ f }: { f: Finding }) {
  const data = useXray((s) => s.data);
  const [results, setResults] = useState<Record<string, HypothesisResult>>({});
  const open = data ? openHypotheses(f, data) : [];
  if (!data || open.length === 0) return null;
  return (
    <div className="mt-7">
      <p className="label">Other hypotheses</p>
      <ul className="mt-3">
        {open.map((h) => {
          const r = results[h.metric];
          const m: Metric = METRICS[h.metric];
          return (
            <li key={h.metric} className="border-t border-line py-2.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className={`text-sm leading-snug ${r ? "text-ink" : "text-ink-2"}`}>{m.label}</span>
                {r ? (
                  <span className="label whitespace-nowrap text-ink">{r.supported ? "Supported" : "Not supported"}</span>
                ) : (
                  <button
                    type="button" aria-label={`Test hypothesis: ${h.statement}`}
                    onClick={() => setResults((prev) => ({ ...prev, [h.metric]: testHypothesis(data, f, h.metric) }))}
                    className="label pointer-events-auto cursor-pointer whitespace-nowrap text-ink-2 transition-colors hover:text-ink"
                  >
                    [ Test ]
                  </button>
                )}
              </div>
              {r && (
                <p className="label mt-1.5 tracking-wider normal-case">
                  {formatValue(r.driver.before, m.unit)} → {formatValue(r.driver.after, m.unit)} · {formatP(r.driver.p)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Evidence({ f, stage }: { f: Finding; stage: Stage }) {
  const metric: Metric = METRICS[f.metric];
  const inv = f.investigation;

  if (stage.kind === "metric") {
    return (
      <>
        <p className="label">Evidence</p>
        <div className="mt-4">
          <Sparkline values={inv.rootSeries} periods={f.comparison.periods} unit={metric.unit} label={metric.label} />
        </div>
        <p className="mt-5 text-sm leading-relaxed text-ink-2">{detectionSentence(f)}</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
          <Fact term="Confidence">{formatPct(f.confidence)}</Fact>
          <Fact term="Deviation">{f.z.toFixed(1)} σ</Fact>
          {f.expected !== null && (
            <Fact term="Typical change">
              {metric.den ? formatDelta(f.expected, metric.unit) : formatSignedPct(f.expected)}
            </Fact>
          )}
          <Fact term="Signal">{toneName(f.tone)}</Fact>
        </dl>
      </>
    );
  }

  if (stage.kind === "segment") {
    const step = inv.steps[stage.step!];
    const rows = step.split.members.filter((m) => m.member === step.member || Math.abs(m.share) >= 0.02).slice(0, 7);
    const scale = Math.max(...rows.map((m) => Math.abs(m.share)), 1e-9);
    return (
      <>
        <p className="label">Contribution by {DIM_LABEL[step.dim].toLowerCase()}</p>
        <ul className="mt-4">
          {rows.map((m) => {
            const chosen = m.member === step.member;
            return (
              <li key={m.member} className={`border-t border-line py-2.5 ${chosen ? "" : "text-ink-2"}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{m.member}</span>
                  <span className="tabular-nums">{formatChange(m.change, m.changePct, metric.unit)}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="relative h-px flex-1 bg-line">
                    <span
                      className="absolute top-[-1px] h-[3px]"
                      style={{
                        width: `${(Math.abs(m.share) / scale) * 50}%`,
                        left: m.share >= 0 ? "50%" : undefined, right: m.share < 0 ? "50%" : undefined,
                        background: chosen ? "var(--tone)" : "var(--ink-3)",
                      }}
                    />
                    <span className="absolute left-1/2 top-[-3px] h-[7px] w-px bg-line-strong" />
                  </span>
                  <span className="label w-12 text-right tracking-normal">{formatSignedPct(m.share, 0)}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="label mt-4 tracking-wider normal-case">
          Share of the total change each member accounts for. Bars to the left offset it.
        </p>
      </>
    );
  }

  if (stage.kind === "cause") {
    return (
      <>
        <p className="label">Supporting evidence</p>
        {inv.drivers.length === 0 && <p className="mt-4 text-sm text-ink-2">No candidate metric passed the significance threshold (p &lt; 0.01, shift ≥ 5%).</p>}
        <ul className="mt-4">
          {inv.drivers.map((d) => {
            const m: Metric = METRICS[d.metric];
            return (
              <li key={d.metric} className="border-t border-line py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{m.label}</span>
                  <span className="text-sm tabular-nums">{formatDelta(d.change, m.unit)}</span>
                </div>
                <p className="mt-1 text-sm tabular-nums text-ink-2">
                  {formatValue(d.before, m.unit)} → {formatValue(d.after, m.unit)}
                </p>
                <p className="label mt-2 tracking-wider normal-case">
                  {formatP(d.p)}
                  {d.controlChange !== null && <> · elsewhere {formatDelta(d.controlChange, m.unit)}</>}
                  {d.correlation && <> · weekly r = {d.correlation.r.toFixed(2)}</>}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="label mt-4 tracking-wider normal-case">{CAVEAT}</p>
        <Hypotheses key={f.id + (f.question ?? "")} f={f} />
      </>
    );
  }

  const impact = inv.impact;
  return (
    <>
      <p className="label">Assessment</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        <Fact term="Confidence">{formatPct(f.confidence)}</Fact>
        <Fact term="Share of change">{inv.steps.length ? share(inv.shareOfRoot) : "100%"}</Fact>
        <div className="col-span-2">
          <Fact term="Segment">{scopeLabel(inv.leafScope)}</Fact>
        </div>
        <div className="col-span-2">
          <Fact term="How it is estimated">
            <span className="text-sm leading-relaxed text-ink-2">{impact.basis}</span>
          </Fact>
        </div>
        {impact.unit === "eur" && impact.annualised !== null && (
          <div className="col-span-2">
            <Fact term="Run-rate">
              {formatEur(Math.abs(impact.annualised))} / year <span className="text-ink-3">— assumes no change</span>
            </Fact>
          </div>
        )}
      </dl>
    </>
  );
}

export function Investigation({ finding }: { finding: Finding }) {
  const stage = useXray((s) => s.stage);
  const { next, back, close, goTo, openWhatIf } = useXray.getState();
  const simulable = useXray((s) => (s.data ? canSimulate(s.data) : false));
  const stages = stagesOf(finding);
  const current = stages[Math.min(stage, stages.length - 1)];
  const upcoming = stages[stage + 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, close]);

  const question = !upcoming ? null
    : upcoming.kind === "segment" ? nextQuestion(finding.investigation.steps[upcoming.step!].dim)
    : nextQuestion(upcoming.kind as "cause" | "impact");

  return (
    <section className={`stage-grid tone-${finding.tone}`}>
      <div className="stage-col">
        <button type="button" onClick={close} className="label pointer-events-auto mb-7 flex max-w-full cursor-pointer items-center gap-2 self-start whitespace-nowrap text-left transition-colors hover:text-ink">
          ← {finding.question ? "Your question" : `Finding ${pad(finding.index)} · ${finding.title}`}
          <ToneMark tone={finding.tone} size={7} />
        </button>

        {stage > 0 && (
          <ol className="mb-7 space-y-1.5" aria-label="Path so far">
            {stages.slice(0, stage).map((s, i) => {
              const c = crumb(finding, s);
              return (
                <li key={i}>
                  <button type="button" onClick={() => goTo(i)} className="pointer-events-auto flex w-full cursor-pointer items-baseline gap-3 text-left text-sm text-ink-3 transition-colors hover:text-ink">
                    <span className="label w-5 shrink-0">{pad(i + 1)}</span>
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto tabular-nums">{c.value}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div key={stage} className="reveal">
          <Headline f={finding} stage={current} />
        </div>

        <div className="mt-8 flex items-center gap-8">
          {question ? (
            <button type="button" className="command pointer-events-auto" onClick={next} autoFocus>
              {question} <span aria-hidden>→</span>
            </button>
          ) : simulable ? (
            <button type="button" className="command pointer-events-auto" onClick={() => openWhatIf(finding.id)} autoFocus>
              What can we do? <span aria-hidden>→</span>
            </button>
          ) : (
            <button type="button" className="command pointer-events-auto" onClick={close} autoFocus>
              Back to the scan <span aria-hidden>→</span>
            </button>
          )}
          <span className="label whitespace-nowrap max-lg:hidden">
            {pad(stage + 1)} / {pad(stages.length)}
          </span>
        </div>
      </div>
      <div aria-hidden className="max-lg:hidden" />
      <div className="stage-col">
        <div key={stage} className="reveal">
          <Evidence f={finding} stage={current} />
        </div>
      </div>
    </section>
  );
}
