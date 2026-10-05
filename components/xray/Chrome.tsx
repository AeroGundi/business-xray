"use client";

import { activeFinding, useXray } from "@/store/useXray";
import { stagesOf } from "@/lib/visualization/view";

const CHAPTERS = ["The business", "The scan", "What changed?", "Where?", "Why?", "Impact"];

function useChapter(): number {
  return useXray((s) => {
    if (s.phase === "landing") return 0;
    if (s.phase === "scanning") return 1;
    if (s.phase === "overview" || s.phase === "answer") return 2;
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

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-[var(--gutter)] pt-7 max-lg:bg-gradient-to-b max-lg:from-bg max-lg:from-40% max-lg:to-transparent max-lg:pb-8">
        <button type="button" onClick={restart} disabled={phase === "landing" || phase === "scanning"} className="label pointer-events-auto cursor-pointer text-ink disabled:cursor-default">
          Business X-Ray
        </button>
        <div className="flex items-center gap-6">
          {data && (
            <p className="label max-sm:hidden">
              {data.company} · {data.weeks} weeks · {data.orders.length.toLocaleString("en-GB")} orders
            </p>
          )}
          <button type="button" aria-pressed={reduced} onClick={() => setReducedMotion(!reduced)} className="label pointer-events-auto cursor-pointer transition-colors hover:text-ink">
            Motion {reduced ? "off" : "on"}
          </button>
        </div>
      </header>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between px-[var(--gutter)] pb-7 max-lg:bg-gradient-to-t max-lg:from-bg max-lg:from-55% max-lg:to-transparent max-lg:pt-12">
        <div className="flex items-center gap-4" aria-label={`Chapter ${chapter + 1} of ${CHAPTERS.length}: ${CHAPTERS[chapter]}`}>
          <p className="label text-ink-2">
            {String(chapter + 1).padStart(2, "0")} — {CHAPTERS[chapter]}
          </p>
          <span className="flex gap-1.5" aria-hidden>
            {CHAPTERS.map((c, i) => (
              <span key={c} className="h-px w-5 bg-ink transition-opacity duration-700" style={{ opacity: i === chapter ? 1 : i < chapter ? 0.4 : 0.14 }} />
            ))}
          </span>
        </div>
        {phase === "investigating" && <p className="label max-lg:hidden">← → move · esc close</p>}
        {(phase === "overview" || phase === "answer") && <p className="label max-lg:hidden">/ to ask · synthetic data · seed {data?.seed}</p>}
      </footer>
    </>
  );
}
