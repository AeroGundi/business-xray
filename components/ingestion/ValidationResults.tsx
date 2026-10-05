"use client";

import { useState } from "react";
import { TABLE } from "@/lib/ingestion/schema";
import type { Issue } from "@/lib/ingestion/validate";
import { useIngest } from "@/store/useIngest";
import { RowsTable, StatusMark, StepHeader, formatCount } from "./parts";

const MARK = { blocker: "error", warning: "limited", note: "note" } as const;

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(issue.level === "blocker");
  return (
    <li className="border-t border-line py-4">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 md:grid-cols-[auto_1fr_auto] md:items-baseline">
        <StatusMark status={MARK[issue.level]} />
        <div className="min-w-0">
          <p className={`leading-snug tracking-tight ${issue.level === "note" ? "text-[15px] text-ink-2" : "text-[17px]"}`}>{issue.title}</p>
          {issue.affected !== undefined && !open && <p className="label mt-1.5 normal-case tracking-wider">{formatCount(issue.affected)} {issue.unit} affected</p>}
        </div>
        <button type="button" className="command col-start-2 py-0 md:col-start-3" data-quiet="true" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "View details"}
        </button>
      </div>
      {open && (
        <div className="reveal ml-8 mt-3 max-w-2xl">
          <p className="text-sm leading-relaxed text-ink-2">{issue.detail}</p>
          {issue.affected !== undefined && <p className="label mt-3 normal-case tracking-wider">{formatCount(issue.affected)} {issue.unit} affected</p>}
          <p className="mt-3 text-sm leading-relaxed">
            <span className="label mr-3">Way forward</span>
            {issue.fix}
          </p>
          {issue.sample && (
            <div className="mt-4">
              <p className="label mb-3">From your file</p>
              <RowsTable headers={issue.sample.headers} rows={issue.sample.rows} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const joinNames = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function ValidationResults() {
  const analysis = useIngest((s) => s.analysis);
  const go = useIngest((s) => s.go);
  const [showNotes, setShowNotes] = useState(false);
  if (!analysis) return null;
  const { issues, extracted, normalised } = analysis;
  const blockers = issues.filter((i) => i.level === "blocker");
  const warnings = issues.filter((i) => i.level === "warning");
  const absent = issues.filter((i) => i.id.startsWith("absent-"));
  const notes = issues.filter((i) => i.level === "note" && !i.id.startsWith("absent-"));
  const read = Object.values(extracted.rowsRead).reduce((s, n) => s + n, 0);
  const aside = extracted.rejections.reduce((s, r) => s + r.rows.length, 0);
  const without = [
    ...(issues.some((i) => i.id === "no-customer") ? ["customer analysis"] : []),
    ...(issues.some((i) => i.id === "no-product") ? ["product analysis"] : []),
    ...absent.map((i) => `${TABLE[i.table!].label.toLowerCase()} data`),
  ];

  return (
    <div className="ingest-col">
      <div className="reveal">
        <StepHeader
          label="Data validation"
          title={blockers.length ? "We need your help before scanning" : warnings.length ? "Your data can be analyzed" : "Your data is in good shape"}
        >
          {blockers.length
            ? "Something essential is missing. Here is what, and how to fix it."
            : `${formatCount(read)} rows were checked. ${aside ? `${formatCount(aside)} could not be used and were set aside; nothing was changed silently.` : "Every row could be used."}`}
        </StepHeader>
      </div>

      {blockers.length > 0 && (
        <section className="mt-12" aria-label="Needs fixing">
          <p className="label" style={{ color: "var(--risk)" }}>Needs fixing</p>
          <ul className="mt-4">{blockers.map((i) => <IssueRow key={i.id} issue={i} />)}</ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="mt-12" aria-label="Worth knowing">
          <p className="label text-ink-2">Worth knowing · {warnings.length}</p>
          <ul className="mt-4">{warnings.map((i) => <IssueRow key={i.id} issue={i} />)}</ul>
        </section>
      )}

      {absent.length > 0 && normalised.data && (
        <section className="mt-12" aria-label="Data not provided">
          <p className="label text-ink-2">Not provided · your X-Ray can still continue</p>
          <ul className="mt-4">
            {absent.map((i) => (
              <li key={i.id} className="grid grid-cols-[auto_1fr] gap-x-4 border-t border-line py-4">
                <StatusMark status="unavailable" />
                <div>
                  <p className="text-[17px] tracking-tight">{i.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{i.detail.replace("Your X-Ray can still continue. ", "")}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className="mt-12" aria-label="Notes">
          <button type="button" className="label cursor-pointer transition-colors hover:text-ink-2" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>
            {showNotes ? "−" : "+"} {notes.length} {notes.length === 1 ? "note" : "notes"} on how your data was read
          </button>
          {showNotes && <ul className="mt-4">{notes.map((i) => <IssueRow key={i.id} issue={i} />)}</ul>}
        </section>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-2">
        <button type="button" className="command" data-quiet={blockers.length === 0} onClick={() => go("mapping")}>
          <span aria-hidden>←</span> {blockers.length ? "Fix the mapping" : "Mapping"}
        </button>
        {blockers.length > 0 ? (
          <button type="button" className="command" onClick={() => go("connect")}>
            Add or replace files
          </button>
        ) : (
          <button type="button" className="command whitespace-normal text-left" onClick={() => go("readiness")}>
            {without.length > 2 ? "Continue with what is available" : without.length ? `Continue without ${joinNames(without)}` : "Continue"} <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
