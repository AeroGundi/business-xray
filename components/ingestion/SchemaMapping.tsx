"use client";

import { CONFIDENCE, type ColumnMatch, type SourceMapping, band, needsConfirmation } from "@/lib/ingestion/detect";
import type { Relationship } from "@/lib/ingestion/extract";
import type { RawTable } from "@/lib/ingestion/parse";
import type { Profile } from "@/lib/ingestion/profile";
import { TABLE, TABLES, type TableId, fieldOf } from "@/lib/ingestion/schema";
import { pendingConfirmations, useIngest } from "@/store/useIngest";
import { StepHeader, formatCount } from "./parts";

const BAND = {
  high: { name: "High", tone: "var(--positive)" },
  medium: { name: "Medium", tone: "var(--ink)" },
  low: { name: "Low", tone: "var(--attention)" },
};

/** Confidence as five marks plus the figure; the band is also named, never colour alone. */
function Confidence({ value }: { value: number }) {
  const b = BAND[band(value)];
  const on = Math.max(1, Math.round(value * 5));
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap" style={{ ["--tone" as string]: b.tone }}>
      <span className="meter" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} data-on={i < on} />)}
      </span>
      <span className="font-mono text-[12px] tabular-nums tracking-wide">{Math.round(value * 100)}%</span>
      <span className="label text-[10px]" style={{ color: b.tone }}>{b.name}</span>
    </span>
  );
}

function ColumnRow({ source, table, match, profile, rivalName }: { source: RawTable; table: TableId; match: ColumnMatch; profile: Profile; rivalName?: string }) {
  const { setField, confirm } = useIngest.getState();
  const pending = needsConfirmation(match);
  const field = match.field ? fieldOf(table, match.field) : undefined;
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line py-3.5 md:grid-cols-[minmax(0,1.1fr)_1.5rem_minmax(0,1fr)_auto] md:items-baseline">
      <div className="min-w-0">
        <p className="truncate text-[15px] tracking-tight">{profile.header}</p>
        <p className="mt-1 truncate font-mono text-[11px] tracking-wide text-ink-3">{profile.samples.join("  ·  ") || "empty"}</p>
      </div>
      <span className="text-ink-3 max-md:hidden" aria-hidden>→</span>
      <div className="min-w-0">
        <select
          className="field-select" data-empty={!match.field} value={match.field ?? ""} aria-label={`What “${profile.header}” contains`}
          onChange={(e) => setField(source.id, match.column, e.target.value || null)}
        >
          <option value="">Ignore column</option>
          {TABLE[table].fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {field && (
          <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
            {pending && rivalName ? `We found two possible columns for ${field.label}: this one and “${rivalName}”. Please choose one.` : match.reasons.join(" · ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-5 md:justify-end">
        {match.field && (match.confirmed ? <span className="label text-ink-2">Confirmed</span> : <Confidence value={match.confidence} />)}
        {pending && (
          <button type="button" className="command py-0" onClick={() => confirm(source.id, match.column)}>
            Confirm
          </button>
        )}
      </div>
    </li>
  );
}

function SourceSection({ source, mapping, profiles }: { source: RawTable; mapping: SourceMapping; profiles: Profile[] }) {
  const setTable = useIngest((s) => s.setTable);
  const used = mapping.columns.filter((c) => c.field !== null);
  const unused = mapping.columns.filter((c) => c.field === null);
  // Columns that need attention first, then by confidence.
  const order = (c: ColumnMatch) => (needsConfirmation(c) ? 0 : 1);
  const sorted = [...used].sort((a, b) => order(a) - order(b) || a.column - b.column);
  return (
    <section className="mt-12" aria-label={source.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h3 className="font-mono text-[13px] tracking-wide">{source.name}</h3>
        <p className="label flex items-baseline gap-3 normal-case tracking-wider">
          <span>{formatCount(source.rows.length)} rows · read as</span>
          <select className="field-select" data-empty={!mapping.table} value={mapping.table ?? ""} aria-label={`What ${source.name} contains`} onChange={(e) => setTable(source.id, (e.target.value || null) as TableId | null)}>
            <option value="">Not used</option>
            {TABLES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </p>
      </div>
      {mapping.table ? (
        <>
          <div className="label mt-5 grid-cols-[minmax(0,1.1fr)_1.5rem_minmax(0,1fr)_auto] gap-x-6 pb-2 max-md:hidden md:grid">
            <span>Your data</span><span /><span>Business X-Ray</span><span>Confidence</span>
          </div>
          <ul>
            {sorted.map((c) => (
              <ColumnRow key={c.column} source={source} table={mapping.table!} match={c} profile={profiles[c.column]} rivalName={c.rival !== undefined ? source.headers[c.rival] : undefined} />
            ))}
          </ul>
          {unused.length > 0 && (
            <details className="mt-1 border-t border-line pt-3">
              <summary className="label cursor-pointer transition-colors hover:text-ink-2">{unused.length} {unused.length === 1 ? "column" : "columns"} not used</summary>
              <ul className="mt-2">
                {unused.map((c) => <ColumnRow key={c.column} source={source} table={mapping.table!} match={c} profile={profiles[c.column]} />)}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="mt-4 max-w-xl border-t border-line pt-4 text-sm leading-relaxed text-ink-2">
          We could not tell what this file contains, so it is not used. If it holds one of the tables the X-Ray understands, choose it above.
        </p>
      )}
    </section>
  );
}

/** How the uploaded files connect: the business as a system rather than separate files. */
function Relationships({ relationships }: { relationships: Relationship[] }) {
  if (relationships.length === 0) return null;
  return (
    <section className="mt-16" aria-label="Relationships between files">
      <p className="label text-ink-2">How your files connect</p>
      <ul className="mt-5">
        {relationships.map((r) => {
          const pct = Math.floor(r.rate * 1000) / 10;
          return (
            <li key={`${r.child}-${r.parent}`} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line py-3.5">
              <span className="w-28 text-[15px] tracking-tight">{TABLE[r.child].label}</span>
              <span className="font-mono text-[11px] tracking-wide text-ink-3">{r.childField}</span>
              <span className="link-line" aria-hidden />
              <span aria-hidden className="text-ink-3">→</span>
              <span className="w-28 text-[15px] tracking-tight">{TABLE[r.parent].label}</span>
              <span className="w-56 text-right font-mono text-[12px] tracking-wide" style={{ color: r.rate >= 0.99 ? "var(--ink-2)" : "var(--attention)" }}>
                {pct}% of {TABLE[r.child].rows} connect
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SchemaMapping() {
  const tables = useIngest((s) => s.tables);
  const detection = useIngest((s) => s.detection);
  const analysis = useIngest((s) => s.analysis);
  const busy = useIngest((s) => s.busy);
  const go = useIngest((s) => s.go);
  if (!detection) return null;
  const pending = pendingConfirmations(detection);
  const columns = detection.mappings.reduce((s, m) => s + m.columns.length, 0);
  const understood = detection.mappings.reduce((s, m) => s + m.columns.filter((c) => c.field).length, 0);

  return (
    <div className="ingest-col">
      <div className="reveal">
        <StepHeader label="Smart schema detection" title="This is what we understood">
          {understood} of {columns} columns were matched to the X-Ray&rsquo;s model.{" "}
          {pending > 0 ? `${pending} ${pending === 1 ? "needs" : "need"} your confirmation: we would rather ask than guess.` : "Change anything that looks wrong."}
        </StepHeader>
        <p className="label mt-6 normal-case tracking-wider">
          High {Math.round(CONFIDENCE.high * 100)}–100% · Medium {Math.round(CONFIDENCE.confirm * 100)}–{Math.round(CONFIDENCE.high * 100) - 1}% · Low under {Math.round(CONFIDENCE.confirm * 100)}%, always confirmed by you
        </p>
      </div>

      {detection.mappings.map((m) => {
        const source = tables.find((t) => t.id === m.source)!;
        return <SourceSection key={m.source} source={source} mapping={m} profiles={detection.profiles[m.source]} />;
      })}

      {analysis && <Relationships relationships={analysis.relationships} />}

      <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-2">
        <button type="button" className="command" data-quiet="true" onClick={() => go("connect")}>
          <span aria-hidden>←</span> Files
        </button>
        <button type="button" className="command disabled:cursor-default disabled:opacity-40" disabled={pending > 0 || busy} onClick={() => go("validation")}>
          {busy ? "Re-checking" : "Continue"} <span aria-hidden>→</span>
        </button>
        {pending > 0 && <p className="label normal-case tracking-wider" style={{ color: "var(--attention)" }}>Confirm or change {pending} {pending === 1 ? "mapping" : "mappings"} to continue</p>}
      </div>
    </div>
  );
}
