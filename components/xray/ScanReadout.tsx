"use client";

import { SCAN_STAGES } from "@/lib/engine/scan";
import { useXray } from "@/store/useXray";

const pad = (n: number) => String(n).padStart(2, "0");

export function ScanReadout() {
  const index = useXray((s) => s.scanIndex);
  const readouts = useXray((s) => s.readouts);
  const stage = SCAN_STAGES[index];
  const lines = readouts[index];

  return (
    <section className="flex h-full flex-col justify-between px-[var(--gutter)] pb-24 pt-28 max-lg:justify-end max-lg:gap-10">
      <div className="flex flex-1 flex-col justify-center max-lg:flex-none lg:max-w-[26vw]">
        <p className="label">
          Scanning — {pad(index + 1)} / {pad(SCAN_STAGES.length)}
        </p>
        <h2 key={stage.id} className="reveal display mt-5 text-[clamp(2.6rem,5.4vw,5.5rem)]">
          <span className="block">{stage.label}</span>
        </h2>
        <ul className="mt-6 min-h-[5.2em] space-y-1.5 font-mono text-[13px] tracking-wide text-ink-2" aria-live="polite">
          {lines?.map((line, i) => (
            <li key={`${stage.id}-${i}`} className="reveal">
              <span className="block" style={{ animationDelay: `${i * 140}ms` }}>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <ol className="mx-auto grid w-full max-w-3xl grid-cols-6 gap-2">
        {SCAN_STAGES.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-2">
            <span className="h-px w-full origin-left bg-ink transition-[opacity,transform] duration-700 ease-xray" style={{ opacity: i <= index ? 0.9 : 0.15, transform: `scaleX(${i <= index ? 1 : 0.999})` }} />
            <span className={`label max-sm:hidden ${i === index ? "text-ink" : i < index ? "text-ink-2" : ""}`}>{s.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
