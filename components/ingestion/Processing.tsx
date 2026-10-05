"use client";

import { PROCESS_LABELS } from "@/lib/ingestion/pipeline";
import { useIngest } from "@/store/useIngest";
import { StatusMark, StepHeader } from "./parts";

/** The analysis sequence: each line appears with what that step actually found. */
export function Processing() {
  const steps = useIngest((s) => s.steps);
  const done = useIngest((s) => s.done);
  return (
    <div className="ingest-col flex min-h-full flex-col justify-center">
      <div className="reveal">
        <StepHeader label="File analysis" title="Analyzing your business" />
      </div>
      <ol className="mt-12 max-w-2xl" aria-live="polite">
        {PROCESS_LABELS.map((label, i) => {
          const state = i < done ? "done" : i === done ? "active" : "waiting";
          return (
            <li key={label} className="grid grid-cols-[1fr_auto_1rem] items-baseline gap-4 border-t border-line py-2.5 transition-opacity duration-500" style={{ opacity: state === "waiting" ? 0.28 : 1 }}>
              <span className={`font-mono text-[13px] tracking-wide ${state === "active" ? "dots text-ink" : "text-ink-2"}`}>{label}</span>
              <span className="font-mono text-[12px] tracking-wide text-ink">{state === "done" ? steps[i]?.result : ""}</span>
              {state === "done" ? <StatusMark status="available" /> : <span />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
