"use client";

import { useState } from "react";
import { TABLE, fieldOf } from "@/lib/ingestion/schema";
import { useIngest } from "@/store/useIngest";
import { RowsTable, formatCount } from "./parts";

const CURRENCIES = ["€", "$", "£", "MX$", "R$", "CHF ", "kr "];

/** A light look at what was imported: each table and a few of its rows. */
function DataPreview() {
  const tables = useIngest((s) => s.tables);
  const detection = useIngest((s) => s.detection);
  const analysis = useIngest((s) => s.analysis);
  const [open, setOpen] = useState<string | null>(null);
  if (!detection || !analysis) return null;
  const used = detection.mappings.filter((m) => m.table);
  const current = used.find((m) => m.source === open);
  const source = current ? tables.find((t) => t.id === current.source) : undefined;
  return (
    <section aria-label="Imported data">
      <p className="label text-ink-2">Your imported business</p>
      <ul className="mt-4 grid grid-cols-2 gap-x-8 sm:grid-cols-3 lg:grid-cols-6">
        {used.map((m) => (
          <li key={m.source} className="border-t border-line">
            <button type="button" aria-expanded={open === m.source} onClick={() => setOpen(open === m.source ? null : m.source)} className="group w-full cursor-pointer py-3 text-left">
              <span className={`label block transition-colors ${open === m.source ? "text-ink" : "text-ink-2 group-hover:text-ink"}`}>{TABLE[m.table!].label}</span>
              <span className="mt-1 block font-mono text-[12px] tracking-wide text-ink-3">{formatCount(analysis.extracted.records[m.table!]?.length ?? 0)} rows</span>
            </button>
          </li>
        ))}
      </ul>
      {current && source && (
        <div className="reveal mt-5">
          <RowsTable
            headers={source.headers} rows={source.rows.slice(0, 5)}
            labels={current.columns.map((c) => (c.field ? (fieldOf(current.table!, c.field)?.label ?? null) : null))}
          />
        </div>
      )}
    </section>
  );
}

export function ReadyToScan() {
  const analysis = useIngest((s) => s.analysis);
  const company = useIngest((s) => s.company);
  const currency = useIngest((s) => s.currency);
  const { go, begin, setIdentity } = useIngest.getState();
  const summary = analysis?.normalised.summary;
  const readiness = analysis?.readiness;
  if (!summary || !readiness) return null;
  const figures = [
    ...(summary.customers ? [[summary.customers, "customers"] as const] : []),
    [summary.orders, summary.orders === 1 ? "order" : "orders"] as const,
    ...(summary.products > 1 ? [[summary.products, "products"] as const] : []),
    ...(summary.countries > 1 ? [[summary.countries, "countries"] as const] : []),
    [summary.months, "months"] as const,
  ];
  const available = readiness.capabilities.filter((c) => c.status !== "unavailable").length;

  return (
    <div className="ingest-col">
      <div className="reveal">
        <p className="label text-ink-2">Business ready to scan</p>
        <h2 className="display mt-5 text-[clamp(2.6rem,7vw,6.5rem)]">
          Your business
          <br />
          is ready to scan
        </h2>
        <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
          {figures.map(([value, label]) => (
            <div key={label}>
              <dd className="figure text-[clamp(1.8rem,3.4vw,3rem)]">{formatCount(value)}</dd>
              <dt className="label mt-2">{label}</dt>
            </div>
          ))}
        </dl>
        <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-4 border-t border-line pt-6">
          <div>
            <dt className="label">Data readiness</dt>
            <dd className="mt-2 text-2xl tracking-tight">{Math.round(readiness.score * 100)}%</dd>
          </div>
          <div>
            <dt className="label">Available analysis</dt>
            <dd className="mt-2 text-2xl tracking-tight">{available}<span className="text-ink-3"> of {readiness.capabilities.length}</span></dd>
          </div>
          <div>
            <dt className="label">Period</dt>
            <dd className="mt-2 text-2xl tracking-tight">{summary.from} <span className="text-ink-3">to</span> {summary.to}</dd>
          </div>
        </dl>
        <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-4">
          <label className="flex flex-col gap-2">
            <span className="label">Business name</span>
            <input className="text-input w-56" value={company} maxLength={40} onChange={(e) => setIdentity({ company: e.target.value })} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Amounts are in</span>
            <select className="field-select" value={currency} onChange={(e) => setIdentity({ currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c.trim()}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-10">
          <button type="button" className="command text-[14px]" onClick={begin} autoFocus>
            Begin X-Ray <span aria-hidden>→</span>
          </button>
          <button type="button" className="command" data-quiet="true" onClick={() => go("readiness")}>
            <span aria-hidden>←</span> Readiness
          </button>
        </div>
      </div>
      <div className="mt-16">
        <DataPreview />
      </div>
    </div>
  );
}
