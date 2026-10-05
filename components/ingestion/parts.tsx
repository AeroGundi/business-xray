"use client";

import type { ReactNode } from "react";
import type { Status } from "@/lib/ingestion/readiness";

/** Shared pieces of the ingestion screens. */

export function StepHeader({ label, title, children }: { label: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header>
      <p className="label text-ink-2">{label}</p>
      <h2 className="display mt-5 text-[clamp(2.2rem,5vw,4.6rem)]">{title}</h2>
      {children && <p className="mt-6 max-w-xl text-[clamp(1rem,1.3vw,1.15rem)] leading-snug tracking-tight text-ink-2">{children}</p>}
    </header>
  );
}

const GLYPH: Record<Status | "error" | "note", { glyph: string; name: string; tone: string }> = {
  available: { glyph: "✓", name: "Available", tone: "var(--positive)" },
  limited: { glyph: "◐", name: "Limited", tone: "var(--attention)" },
  unavailable: { glyph: "✕", name: "Unavailable", tone: "var(--ink-3)" },
  error: { glyph: "✕", name: "Problem", tone: "var(--risk)" },
  note: { glyph: "·", name: "Note", tone: "var(--ink-3)" },
};

/** Status by glyph and by colour, with a text equivalent for assistive technology. */
export function StatusMark({ status }: { status: keyof typeof GLYPH }) {
  const s = GLYPH[status];
  return (
    <span className="inline-block w-4 shrink-0 font-mono text-[13px] leading-none" style={{ color: s.tone }}>
      <span aria-hidden>{s.glyph}</span>
      <span className="sr-only">{s.name}</span>
    </span>
  );
}

/** A 0–1 value as an instrument scale of ticks. */
export function Scale({ value, ticks = 50 }: { value: number; ticks?: number }) {
  const filled = Math.round(value * ticks);
  return (
    <span className="flex h-3 items-end justify-between" aria-hidden>
      {Array.from({ length: ticks }, (_, i) => (
        <span key={i} className="w-px bg-ink" style={{ height: i < filled ? "100%" : "40%", opacity: i < filled ? 0.9 : 0.22 }} />
      ))}
    </span>
  );
}

/** Percentage that never rounds an imperfect value up to 100%. */
export const formatShare = (v: number): string => (v < 1 && v >= 0.995 ? `${(Math.floor(v * 1000) / 10).toFixed(1)}%` : `${Math.round(v * 100)}%`);

export function RowsTable({ headers, rows, labels }: { headers: string[]; rows: (string | number)[][]; labels?: (string | null)[] }) {
  return (
    <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Data preview">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
                {labels && <span className="mt-1 block normal-case tracking-normal text-ink-2">{labels[i] ?? "not used"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map((_, c) => <td key={c}>{r[c] === "" || r[c] === undefined ? "—" : r[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const formatBytes = (b: number): string => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} kB` : `${b} B`);
export const formatCount = (n: number): string => n.toLocaleString("en-GB");

/** Starts a browser download of generated content. */
export function download(name: string, content: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
