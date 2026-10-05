"use client";

import { create } from "zustand";
import { type Detection, assignField, confirmColumn, detectSchema, needsConfirmation, remapAs } from "@/lib/ingestion/detect";
import { ERROR_TEXT, ParseError, type RawTable, readFile } from "@/lib/ingestion/parse";
import { type Analysis, type ProcessStep, evaluate, processSteps } from "@/lib/ingestion/pipeline";
import type { TableId } from "@/lib/ingestion/schema";
import { useXray } from "./useXray";

export type IngestStep = "connect" | "template" | "processing" | "mapping" | "validation" | "readiness" | "ready";
export const INGEST_STEPS: { id: IngestStep; label: string }[] = [
  { id: "connect", label: "Connect your data" },
  { id: "processing", label: "Analyzing" },
  { id: "mapping", label: "Your data, understood" },
  { id: "validation", label: "Validation" },
  { id: "readiness", label: "Data readiness" },
  { id: "ready", label: "Ready to scan" },
];

export interface FileEntry {
  id: string;
  name: string;
  bytes: number;
  status: "reading" | "ready" | "error";
  /** Raw tables read from the file (one per sheet). */
  tables: string[];
  rows: number;
  columns: number;
  error?: { title: string; fix: string };
}

interface IngestState {
  step: IngestStep;
  files: FileEntry[];
  tables: RawTable[];
  detection: Detection | null;
  analysis: Analysis | null;
  steps: ProcessStep[];
  /** Processing steps completed so far. */
  done: number;
  /** A change to the mapping is being re-checked. */
  busy: boolean;
  company: string;
  currency: string;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (id: string) => void;
  analyze: () => Promise<void>;
  setTable: (source: string, table: TableId | null) => void;
  setField: (source: string, column: number, field: string | null) => void;
  confirm: (source: string, column: number) => void;
  setIdentity: (identity: { company?: string; currency?: string }) => void;
  go: (step: IngestStep) => void;
  begin: () => void;
  reset: () => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fileCounter = 0;

export const useIngest = create<IngestState>((set, get) => {
  /** Applies a mapping change, then re-runs validation and readiness once the screen has painted. */
  const remap = (change: (d: Detection) => Detection) => {
    const { detection } = get();
    if (!detection) return;
    const next = change(detection);
    set({ detection: next, busy: true });
    setTimeout(() => {
      const { tables, company, currency } = get();
      if (get().detection !== next) return;
      set({ analysis: evaluate(tables, next.mappings, next.profiles, company, currency), busy: false });
    }, 40);
  };
  const mapOne = (source: string, fn: (m: Detection["mappings"][number], d: Detection) => Detection["mappings"][number]) =>
    remap((d) => ({ ...d, mappings: d.mappings.map((m) => (m.source === source ? fn(m, d) : m)) }));

  return {
    step: "connect", files: [], tables: [], detection: null, analysis: null, steps: [], done: 0, busy: false, company: "Your business", currency: "€",

    addFiles: async (incoming) => {
      for (const file of incoming) {
        const id = `f${++fileCounter}`;
        set({ files: [...get().files, { id, name: file.name, bytes: file.size, status: "reading", tables: [], rows: 0, columns: 0 }] });
        const update = (patch: Partial<FileEntry>) => set({ files: get().files.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
        try {
          const tables = readFile(file.name, new Uint8Array(await file.arrayBuffer()));
          if (!get().files.some((f) => f.id === id)) continue;
          set({ tables: [...get().tables, ...tables] });
          update({ status: "ready", tables: tables.map((t) => t.id), rows: tables.reduce((s, t) => s + t.rows.length, 0), columns: tables.reduce((s, t) => s + t.headers.length, 0) });
        } catch (e) {
          update({ status: "error", error: ERROR_TEXT[e instanceof ParseError ? e.code : "unreadable"] });
        }
      }
    },

    removeFile: (id) => {
      const file = get().files.find((f) => f.id === id);
      set({ files: get().files.filter((f) => f.id !== id), tables: get().tables.filter((t) => !file?.tables.includes(t.id)), detection: null, analysis: null });
    },

    analyze: async () => {
      const { tables, company, currency } = get();
      if (tables.length === 0) return;
      set({ step: "processing", steps: [], done: 0 });
      // Let the screen appear before the analysis occupies the main thread.
      await wait(350);
      const detection = detectSchema(tables);
      const analysis = evaluate(tables, detection.mappings, detection.profiles, company, currency);
      const steps = processSteps(tables, detection, analysis);
      set({ detection, analysis, steps });
      const pace = useXray.getState().reducedMotion ? 60 : 420;
      for (let i = 1; i <= steps.length; i++) {
        await wait(pace);
        if (get().step !== "processing") return;
        set({ done: i });
      }
      await wait(pace * 1.6);
      if (get().step === "processing") set({ step: "mapping" });
    },

    setTable: (source, table) =>
      remap((d) => ({
        ...d,
        // A table belongs to one file: the previous holder is released.
        mappings: d.mappings.map((m) => (m.source === source ? remapAs(d.profiles[source], source, table) : table && m.table === table ? remapAs(d.profiles[m.source], m.source, null) : m)),
      })),
    setField: (source, column, field) => mapOne(source, (m) => assignField(m, column, field)),
    confirm: (source, column) => mapOne(source, (m) => confirmColumn(m, column)),

    setIdentity: (identity) => set(identity),
    go: (step) => set({ step }),

    begin: () => {
      const { tables, detection, company, currency } = get();
      if (!detection) return;
      // Normalised once more so the name and currency chosen on the last screen are the ones analysed.
      const { normalised } = evaluate(tables, detection.mappings, detection.profiles, company.trim() || "Your business", currency);
      if (normalised.data) useXray.getState().load(normalised.data);
    },

    reset: () => set({ step: "connect", files: [], tables: [], detection: null, analysis: null, steps: [], done: 0, busy: false }),
  };
});

/** Mappings the user still has to confirm before continuing. */
export const pendingConfirmations = (d: Detection | null): number =>
  d ? d.mappings.reduce((s, m) => s + (m.table ? m.columns.filter(needsConfirmation).length : 0), 0) : 0;
