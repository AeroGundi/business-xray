import type { Detection, SourceMapping } from "./detect";
import { type Extracted, type Relationship, extract, findRelationships } from "./extract";
import { type Normalised, normaliseDataset } from "./normalize";
import type { RawTable } from "./parse";
import type { Profile } from "./profile";
import { type Readiness, computeReadiness } from "./readiness";
import { TABLE } from "./schema";
import { type Issue, validate } from "./validate";

/**
 * The ingestion pipeline after schema detection:
 *
 *   mapping → typed extraction → relationships → normalisation → validation → readiness
 *
 * Pure and synchronous: given the same files and mapping it always returns
 * the same result, so it is simply run again whenever the user changes a mapping.
 */

export interface Analysis {
  extracted: Extracted;
  relationships: Relationship[];
  normalised: Normalised;
  issues: Issue[];
  readiness: Readiness | null;
}

export function evaluate(tables: RawTable[], mappings: SourceMapping[], profiles: Record<string, Profile[]>, company?: string, currency?: string): Analysis {
  const extracted = extract(tables, mappings, profiles);
  const relationships = findRelationships(extracted);
  const normalised = normaliseDataset(extracted, company, currency);
  const issues = validate(tables, mappings, extracted, relationships, normalised);
  return { extracted, relationships, normalised, issues, readiness: computeReadiness(extracted, relationships, normalised) };
}

export interface ProcessStep {
  id: string;
  label: string;
  /** What the step found, shown once it completes. */
  result: string;
}

/** Step names, known before any result is. */
export const PROCESS_LABELS = [
  "Reading files", "Detecting columns", "Understanding data types", "Detecting relationships", "Validating dates",
  "Checking missing values", "Checking duplicates", "Mapping business entities", "Calculating data readiness",
];

const n = (x: number) => x.toLocaleString("en-GB");

/** The processing sequence shown to the user: each line reports a real result of the corresponding step. */
export function processSteps(tables: RawTable[], detection: Detection, a: Analysis): ProcessStep[] {
  const profiles = Object.values(detection.profiles).flat();
  const kinds = { date: 0, number: 0, text: 0, empty: 0 };
  for (const p of profiles) kinds[p.kind]++;
  const cells = a.extracted.quality.reduce((s, q) => s + q.rows, 0);
  const missing = a.extracted.quality.reduce((s, q) => s + q.missing, 0);
  const duplicates = a.extracted.rejections.filter((r) => r.reason === "duplicate").reduce((s, r) => s + r.rows.length, 0);
  const recognised = detection.mappings.filter((m) => m.table).map((m) => TABLE[m.table!].label);
  const weeks = a.normalised.facts.weeks;
  return [
    { id: "read", label: "Reading files", result: `${tables.length} ${tables.length === 1 ? "file" : "files"} · ${n(tables.reduce((s, t) => s + t.rows.length, 0))} rows` },
    { id: "columns", label: "Detecting columns", result: `${profiles.length} columns` },
    { id: "types", label: "Understanding data types", result: `${kinds.date} dates · ${kinds.number} numbers · ${kinds.text} text` },
    { id: "relationships", label: "Detecting relationships", result: a.relationships.length ? `${a.relationships.length} ${a.relationships.length === 1 ? "link" : "links"} between files` : "single file" },
    { id: "dates", label: "Validating dates", result: weeks ? `${weeks} weeks of history` : "no usable order dates" },
    { id: "missing", label: "Checking missing values", result: cells ? `${((100 * missing) / cells).toFixed(1)}% of cells empty` : "–" },
    { id: "duplicates", label: "Checking duplicates", result: duplicates ? `${n(duplicates)} duplicate rows` : "none found" },
    { id: "entities", label: "Mapping business entities", result: recognised.length ? recognised.join(" · ") : "nothing recognised" },
    { id: "readiness", label: "Calculating data readiness", result: a.readiness ? `${Math.round(a.readiness.score * 100)}%` : "needs your attention" },
  ];
}
