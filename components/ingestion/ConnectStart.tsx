"use client";

import { useRef, useState } from "react";
import { useIngest } from "@/store/useIngest";
import { useXray } from "@/store/useXray";
import { StatusMark, StepHeader, formatBytes, formatCount } from "./parts";

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm";

function UploadZone() {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const addFiles = useIngest((s) => s.addFiles);
  return (
    <div
      className="dropzone" data-active={active}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      <p className="display text-[clamp(1.5rem,2.6vw,2.4rem)]">{active ? "Release to connect" : "Drop your business data here"}</p>
      <p className="label mt-5">CSV or Excel · multiple files supported</p>
      <button type="button" className="command mt-6" onClick={() => input.current?.click()}>
        Browse files
      </button>
      <input
        ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose data files"
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function FileList() {
  const files = useIngest((s) => s.files);
  const removeFile = useIngest((s) => s.removeFile);
  if (files.length === 0) return null;
  return (
    <ul className="mt-8" aria-label="Files added">
      {files.map((f) => (
        <li key={f.id} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 border-t border-line py-3">
          <StatusMark status={f.status === "error" ? "error" : f.status === "ready" ? "available" : "note"} />
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] tracking-wide">{f.name}</p>
            {f.status === "error" ? (
              <p className="mt-1.5 text-sm leading-snug text-ink-2">
                {f.error?.title} <span className="text-ink-3">{f.error?.fix}</span>
              </p>
            ) : (
              <p className="label mt-1.5 normal-case tracking-wider">
                {formatBytes(f.bytes)}
                {f.status === "ready" ? ` · ${formatCount(f.rows)} rows · ${f.columns} columns${f.tables.length > 1 ? ` · ${f.tables.length} sheets` : ""}` : <span className="dots"> · reading</span>}
              </p>
            )}
          </div>
          <button type="button" className="label cursor-pointer transition-colors hover:text-ink" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ConnectStart() {
  const files = useIngest((s) => s.files);
  const { analyze, go } = useIngest.getState();
  const ready = files.filter((f) => f.status === "ready").length;
  const reading = files.some((f) => f.status === "reading");

  return (
    <div className="reveal ingest-col">
      <StepHeader label="Analyze my business" title="Connect your data">
        Bring your business data into the X-Ray.
      </StepHeader>

      <div className="mt-12 grid gap-x-[var(--gutter)] gap-y-12 lg:grid-cols-[1.55fr_1fr]">
        <section aria-labelledby="opt-upload">
          <p id="opt-upload" className="label mb-5 text-ink-2">01 — Upload files</p>
          <UploadZone />
          <FileList />
          {ready > 0 && (
            <button type="button" className="command mt-5" onClick={() => void analyze()} disabled={reading}>
              Analyze {ready} {ready === 1 ? "file" : "files"} <span aria-hidden>→</span>
            </button>
          )}
        </section>

        <div className="flex flex-col gap-10">
          <section aria-labelledby="opt-template" className="border-t border-line pt-5">
            <p id="opt-template" className="label text-ink-2">02 — Use a template</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-2">Not sure what structure to use? See exactly what the X-Ray needs and download files ready to fill in.</p>
            <button type="button" className="command mt-2" onClick={() => go("template")}>
              Choose a template <span aria-hidden>→</span>
            </button>
          </section>

          <section aria-labelledby="opt-connect" className="border-t border-line pt-5">
            <p id="opt-connect" className="label">03 — Connect data · coming soon</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-3">Direct connections to shop platforms and databases are not available yet. Export your data as CSV or Excel for now.</p>
          </section>

          <section aria-labelledby="opt-demo" className="border-t border-line pt-5">
            <p id="opt-demo" className="label">Don&rsquo;t have data ready?</p>
            <button type="button" className="command mt-2" data-quiet="true" onClick={() => useXray.getState().loadDemo()}>
              Load NOVA demo
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
