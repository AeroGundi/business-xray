"use client";

import { useState } from "react";
import { TABLES, type Table } from "@/lib/ingestion/schema";
import { exampleZip, templateFileName, templateSheet, templateZip, toCsv } from "@/lib/ingestion/templates";
import { useIngest } from "@/store/useIngest";
import { useXray } from "@/store/useXray";
import { RowsTable, StepHeader, download } from "./parts";

const TYPES = ["E-commerce", "SaaS", "Retail", "Manufacturing", "Services", "Other"];
const GROUPS: { id: Table["importance"]; label: string; note: string }[] = [
  { id: "required", label: "Required", note: "The X-Ray is built around these." },
  { id: "recommended", label: "Recommended", note: "Each one unlocks more of the analysis." },
  { id: "optional", label: "Optional", note: "The analysis continues without them." },
];

function TemplateRow({ table }: { table: Table }) {
  const [open, setOpen] = useState(false);
  const sheet = templateSheet(table.id);
  const fields = table.fields.filter((f) => f.template);
  return (
    <li className="border-t border-line py-5">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h4 className="text-xl tracking-tight">{table.label}</h4>
          <p className="mt-1.5 text-sm leading-snug text-ink-2">{table.purpose}</p>
          <p className="mt-3 font-mono text-[12px] leading-relaxed tracking-wide text-ink-2">{fields.map((f) => f.id).join("  ·  ")}</p>
        </div>
        <div className="flex items-start gap-7">
          <button type="button" className="command" data-quiet="true" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Preview"}
          </button>
          <button type="button" className="command" onClick={() => download(templateFileName(table.id), toCsv(sheet), "text/csv")} aria-label={`Download ${table.label} template`}>
            Download
          </button>
        </div>
      </div>
      {open && (
        <div className="reveal mt-5">
          <RowsTable headers={sheet.headers} rows={sheet.rows} />
          <dl className="mt-5 grid gap-x-10 gap-y-2.5 md:grid-cols-2">
            {fields.map((f) => (
              <div key={f.id} className="grid grid-cols-[9.5rem_1fr] gap-3 text-sm">
                <dt className="font-mono text-[12px] tracking-wide text-ink">{f.id}</dt>
                <dd className="leading-snug text-ink-2">{f.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

export function TemplateGuide() {
  const [type, setType] = useState("E-commerce");
  const go = useIngest((s) => s.go);
  const demo = useXray((s) => s.data);

  return (
    <div className="reveal ingest-col">
      <StepHeader label="Use a template" title="What kind of business do you have?" />

      <div className="mt-9 flex flex-wrap gap-x-8 gap-y-1" role="radiogroup" aria-label="Business type">
        {TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className="command" data-quiet={type !== t}>
            {t}
          </button>
        ))}
      </div>

      {type !== "E-commerce" ? (
        <div className="mt-10 max-w-lg border-t border-line pt-6">
          <p className="label text-ink-2">Template coming soon</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-2">
            The X-Ray currently understands e-commerce businesses: orders, customers, products, delivery, marketing and returns. A {type === "Other" ? "different" : type} model is not available yet, and it would be misleading to analyse your data with the wrong one.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-1 border-t border-line pt-5">
            <button type="button" className="command" onClick={() => download("business-xray-ecommerce-template.zip", templateZip(), "application/zip")}>
              Download complete e-commerce template
            </button>
            {demo && !demo.available && (
              <button type="button" className="command" data-quiet="true" onClick={() => download("nova-example-data.zip", exampleZip(demo), "application/zip")}>
                Download a filled example
              </button>
            )}
          </div>
          <p className="label mt-2 max-w-xl normal-case tracking-wider">
            Six CSV files with example rows. The filled example is the NOVA demo business in the same format. Your own column names work too: the X-Ray recognises them and asks when it is unsure.
          </p>

          {GROUPS.map((g) => (
            <section key={g.id} className="mt-12" aria-label={`${g.label} data`}>
              <p className="label text-ink-2">
                {g.label} <span className="ml-3 normal-case tracking-wider text-ink-3">{g.note}</span>
              </p>
              <ul className="mt-4">
                {TABLES.filter((t) => t.importance === g.id).map((t) => <TemplateRow key={t.id} table={t} />)}
              </ul>
            </section>
          ))}
        </>
      )}

      <div className="mt-10 flex items-center gap-10">
        <button type="button" className="command" data-quiet="true" onClick={() => go("connect")}>
          <span aria-hidden>←</span> Back
        </button>
        {type === "E-commerce" && (
          <button type="button" className="command" onClick={() => go("connect")}>
            Upload my files <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
