"use client";

import { useEffect } from "react";
import type { Answer } from "@/lib/ai/answer";
import { ToneMark } from "@/components/ui/ToneMark";
import { useXray } from "@/store/useXray";
import { AskBar } from "./AskBar";
import { sourceLabel, useExplanation } from "./useExplanation";

/** An answer in four parts: interpretation, explanation, evidence, next investigation. */
export function AnswerView({ answer }: { answer: Answer }) {
  const { follow, ask, close } = useXray.getState();
  const explanation = useExplanation({ topic: `${answer.question} — ${answer.interpretation}`, draft: answer.explanation, facts: answer.facts });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <section className="stage-grid">
      <div className="stage-col">
        <button type="button" onClick={close} className="label pointer-events-auto mb-7 cursor-pointer self-start transition-colors hover:text-ink">
          ← Overview
        </button>
        <div key={answer.question + answer.interpretation} className="reveal">
          <p className="label">You asked</p>
          <h2 className="display mt-4 text-[clamp(1.7rem,2.6vw,2.7rem)] leading-[1.04]">{answer.question}</h2>
          <p className="label mt-6">Interpreted as</p>
          <p className="mt-2 text-sm text-ink-2">{answer.interpretation}</p>
          <p className="mt-6 max-w-[36ch] text-[1.02rem] leading-relaxed">{explanation.text}</p>
          <p className="label mt-4 tracking-wider normal-case">{sourceLabel(explanation)}</p>
          {answer.next && (
            <button type="button" className="command pointer-events-auto mt-6" onClick={() => follow(answer.next!.action, answer.next!.label)} autoFocus>
              {answer.next.label} <span aria-hidden>→</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-end max-lg:pt-8">
        <AskBar suggestions={false} />
      </div>

      <div className="stage-col">
        <div key={answer.question + answer.rowsTitle} className="reveal">
          <p className="label">{answer.rowsTitle}</p>
          <ul className="mt-4">
            {answer.rows.map((row) => {
              const body = (
                <>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.98rem] tracking-tight">{row.label}</span>
                    {row.detail && <span className="mt-1 block text-[0.8rem] leading-snug text-ink-3">{row.detail}</span>}
                  </span>
                  {row.value && (
                    <span className={`flex items-center gap-2 tabular-nums tracking-tight ${row.tone ? `tone-${row.tone}` : ""}`} style={row.tone ? { color: "var(--tone)" } : undefined}>
                      {row.value}
                      {row.tone && <ToneMark tone={row.tone} />}
                    </span>
                  )}
                </>
              );
              const cls = "grid w-full grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-line py-3 text-left";
              return (
                <li key={row.label}>
                  {row.action || answer.kind === "unknown" ? (
                    <button
                      type="button" className={`${cls} pointer-events-auto cursor-pointer transition-colors hover:text-ink ${answer.kind === "unknown" ? "text-ink-2" : ""}`}
                      onClick={() => (row.action ? follow(row.action, `Why ${row.label}?`) : ask(row.label))}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
