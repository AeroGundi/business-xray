"use client";

import { type Capability, type Status, WEIGHTS } from "@/lib/ingestion/readiness";
import { useIngest } from "@/store/useIngest";
import { Scale, StatusMark, formatShare } from "./parts";

const pct = formatShare;
const COLUMNS: { status: Status; label: string }[] = [
  { status: "available", label: "Available analysis" },
  { status: "limited", label: "Limited" },
  { status: "unavailable", label: "Unavailable" },
];

/** What the X-Ray can and cannot do with this data, with the reason in terms of the data. */
export function CapabilityMatrix({ capabilities }: { capabilities: Capability[] }) {
  return (
    <div className="grid gap-x-[var(--gutter)] gap-y-10 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = capabilities.filter((c) => c.status === col.status);
        return (
          <section key={col.status} aria-label={col.label}>
            <p className="label text-ink-2">{col.label} · {items.length}</p>
            <ul className="mt-4">
              {items.length === 0 && <li className="border-t border-line py-3 text-sm text-ink-3">None</li>}
              {items.map((c) => (
                <li key={c.id} className="grid grid-cols-[auto_1fr] gap-x-3 border-t border-line py-3">
                  <StatusMark status={c.status} />
                  <div>
                    <p className={`text-[15px] leading-snug tracking-tight ${c.status === "unavailable" ? "text-ink-2" : ""}`}>{c.label}</p>
                    {c.reason && <p className="mt-1 text-[12px] leading-snug text-ink-3">{c.reason}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DataReadiness() {
  const readiness = useIngest((s) => s.analysis?.readiness ?? null);
  const go = useIngest((s) => s.go);
  if (!readiness) return null;
  return (
    <div className="ingest-col">
      <div className="reveal grid gap-x-[var(--gutter)] gap-y-10 lg:grid-cols-[1fr_1.2fr] lg:items-end">
        <div>
          <p className="label text-ink-2">Data readiness</p>
          <p className="figure mt-4 text-[clamp(5.5rem,13vw,11rem)]">
            {Math.round(readiness.score * 100)}
            <span className="text-[0.3em] tracking-normal text-ink-3">%</span>
          </p>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-2">
            How well your data can support the X-Ray. A weighted average of five measured dimensions; nothing here is a judgement.
          </p>
        </div>
        <dl>
          {readiness.dimensions.map((d) => (
            <div key={d.id} className="border-t border-line py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="label text-ink-2">{d.label}</dt>
                <dd className="font-mono text-[13px] tabular-nums tracking-wide">
                  {d.score === null ? "n/a" : pct(d.score)}
                  <span className="ml-3 text-ink-3">weight {pct(WEIGHTS[d.id])}</span>
                </dd>
              </div>
              {d.score !== null && <div className="mt-2.5"><Scale value={d.score} /></div>}
              <dd className="mt-2 text-[12px] leading-snug text-ink-3">{d.detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="mt-14 grid grid-cols-2 gap-x-8 border-t border-line sm:grid-cols-4" aria-label="Coverage by business area">
        {readiness.entities.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
            <span className="label text-ink-2">{e.label}</span>
            <StatusMark status={e.status} />
          </li>
        ))}
      </ul>

      <div className="mt-14">
        <CapabilityMatrix capabilities={readiness.capabilities} />
      </div>

      <div className="mt-12 flex items-center gap-10">
        <button type="button" className="command" data-quiet="true" onClick={() => go("validation")}>
          <span aria-hidden>←</span> Validation
        </button>
        <button type="button" className="command" onClick={() => go("ready")}>
          Continue <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
