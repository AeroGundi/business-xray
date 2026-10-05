"use client";

import { INGEST_STEPS, useIngest } from "@/store/useIngest";
import { activeFinding, useXray } from "@/store/useXray";
import { stagesOf } from "@/lib/visualization/view";

const CHAPTERS = ["The business", "The scan", "What changed?", "Where?", "Why?", "Impact", "What if?", "Decision"];

function useChapter(): number {
  return useXray((s) => {
    if (s.phase === "landing") return 0;
    if (s.phase === "scanning") return 1;
    if (s.phase === "overview" || s.phase === "answer") return 2;
    if (s.phase === "whatif") return 6;
    if (s.phase === "decision") return 7;
    const f = activeFinding(s);
    const kind = f ? stagesOf(f)[s.stage]?.kind : "metric";
    return kind === "segment" ? 3 : kind === "cause" ? 4 : kind === "impact" ? 5 : 2;
  });
}

/** Minimal frame: wordmark, context, chapter position, motion preference. */
export function Chrome() {
  const phase = useXray((s) => s.phase);
  const data = useXray((s) => s.data);
  const reduced = useXray((s) => s.reducedMotion);
  const { restart, setReducedMotion } = useXray.getState();
  const chapter = useChapter();
  const ingestStep = useIngest((s) => s.step);
  // The ingestion flow is a prologue with its own steps; the template guide belongs to the first one.
  const connecting = phase === "connect";
  const ingestIndex = Math.max(0, INGEST_STEPS.findIndex((s) => s.id === ingestStep));
  const marks = connecting ? INGEST_STEPS.map((s) => s.label) : CHAPTERS;
  const position = connecting ? ingestIndex : chapter;

  return (
    <>
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-[var(--gutter)] pt-7 ${connecting ? "bg-gradient-to-b from-bg from-40% to-transparent pb-8" : "max-lg:bg-gradient-to-b max-lg:from-bg max-lg:from-40% max-lg:to-transparent max-lg:pb-8"}`}>
        <button type="button" onClick={restart} disabled={phase === "landing" || phase === "scanning"} className="label pointer-events-auto cursor-pointer text-ink disabled:cursor-default">
          Business X-Ray
        </button>
        <div className="flex items-center gap-6">
          {data && !connecting && (
            <p className="label max-sm:hidden">
              {data.company} · {data.weeks} weeks · {data.orders.length.toLocaleString("en-GB")} orders
            </p>
          )}
          <button type="button" aria-pressed={reduced} onClick={() => setReducedMotion(!reduced)} className="label pointer-events-auto cursor-pointer transition-colors hover:text-ink">
            Motion {reduced ? "off" : "on"}
          </button>
        </div>
      </header>

      <footer className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between px-[var(--gutter)] pb-7 ${connecting ? "bg-gradient-to-t from-bg from-55% to-transparent pt-12" : "max-lg:bg-gradient-to-t max-lg:from-bg max-lg:from-55% max-lg:to-transparent max-lg:pt-12"}`}>
        <div className="flex items-center gap-4" aria-label={`${connecting ? "Step" : "Chapter"} ${position + 1} of ${marks.length}: ${marks[position]}`}>
          <p className="label text-ink-2">
            {connecting ? "Your data" : String(chapter + 1).padStart(2, "0")} — {marks[position]}
          </p>
          <span className="flex gap-1.5" aria-hidden>
            {marks.map((c, i) => (
              <span key={c} className="h-px w-5 bg-ink transition-opacity duration-700" style={{ opacity: i === position ? 1 : i < position ? 0.4 : 0.14 }} />
            ))}
          </span>
        </div>
        {phase === "investigating" && <p className="label max-lg:hidden">← → move · esc close</p>}
        {(phase === "overview" || phase === "answer") && <p className="label max-lg:hidden">/ to ask · {data?.available ? "your uploaded data" : `synthetic data · seed ${data?.seed}`}</p>}
      </footer>
    </>
  );
}
