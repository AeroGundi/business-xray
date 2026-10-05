import { joinKey, type SourceMapping } from "./detect";
import type { RawTable } from "./parse";
import type { Profile } from "./profile";
import { RELATIONS, TABLE, TABLES, type TableId } from "./schema";
import { type DateOrder, isBlank, parseDate, parseNumber } from "./values";
import { excelSerialToIso } from "./parse";

/**
 * VALIDATION, step 1 — typed extraction.
 * Reads every mapped column with the type its canonical field requires and
 * counts, per field, what was missing or could not be interpreted. Rows that
 * cannot be used are set aside with the reason; nothing is silently repaired.
 */

export type Value = string | number | null;
/** One row of a canonical table: canonical field id → typed value. `_row` is the source row number. */
export type Rec = Record<string, Value> & { _row: number };

export interface FieldQuality {
  table: TableId;
  field: string;
  header: string;
  rows: number;
  missing: number;
  /** Filled but not interpretable as the field's type. */
  invalid: number;
  invalidExamples: string[];
}

export interface Rejection {
  table: TableId;
  reason: "missing" | "invalid" | "impossible" | "duplicate";
  /** Canonical field the problem was found in, when it concerns one. */
  field?: string;
  rows: number[];
}

export interface Extracted {
  records: Partial<Record<TableId, Rec[]>>;
  sources: Partial<Record<TableId, RawTable>>;
  /** Canonical field → header in the user's file. */
  headers: Partial<Record<TableId, Record<string, string>>>;
  quality: FieldQuality[];
  rejections: Rejection[];
  rowsRead: Partial<Record<TableId, number>>;
  /** Columns whose day/month order could not be decided from the values. */
  ambiguousDates: { table: TableId; header: string }[];
}

const has = (rec: Rec, field: string): boolean => rec[field] !== null && rec[field] !== undefined;
export const num = (rec: Rec, field: string): number | null => (typeof rec[field] === "number" ? (rec[field] as number) : null);
export const str = (rec: Rec, field: string): string | null => (typeof rec[field] === "string" ? (rec[field] as string) : null);

/** Dates outside this range are treated as data errors rather than history. */
const EARLIEST = Date.UTC(1990, 0, 1);

export function extract(tables: RawTable[], mappings: SourceMapping[], profiles: Record<string, Profile[]>, now = Date.now()): Extracted {
  const out: Extracted = { records: {}, sources: {}, headers: {}, quality: [], rejections: [], rowsRead: {}, ambiguousDates: [] };

  for (const mapping of mappings) {
    if (!mapping.table) continue;
    const tableId = mapping.table;
    const source = tables.find((t) => t.id === mapping.source)!;
    const def = TABLE[tableId];
    const cols = mapping.columns.filter((c) => c.field !== null).map((c) => {
      const field = def.fields.find((f) => f.id === c.field)!;
      const profile = profiles[source.id][c.column];
      const q: FieldQuality = { table: tableId, field: field.id, header: source.headers[c.column], rows: source.rows.length, missing: 0, invalid: 0, invalidExamples: [] };
      if (field.type === "date" && profile.dateAmbiguous) out.ambiguousDates.push({ table: tableId, header: q.header });
      return { index: c.column, field, order: profile.dateOrder as DateOrder, serial: profile.serialDates, q };
    });

    const reject = new Map<string, number[]>();
    const drop = (reason: Rejection["reason"], field: string | undefined, row: number) => {
      const key = `${reason}|${field ?? ""}`;
      if (!reject.has(key)) reject.set(key, []);
      reject.get(key)!.push(row);
    };
    const required = def.fields.filter((f) => f.level === "required").map((f) => f.id);
    // An order line is usable with either a unit price or a line total.
    const needs = tableId === "orders" ? required.filter((f) => f !== "unit_price") : required;
    const present = new Set(cols.map((c) => c.field.id));
    const seen = new Set<string>();
    const keyed = new Map<string, number>();
    const records: Rec[] = [];

    rows: for (let r = 0; r < source.rows.length; r++) {
      const raw = source.rows[r];
      const signature = raw.join("\u0001");
      if (seen.has(signature)) {
        drop("duplicate", undefined, r);
        continue;
      }
      seen.add(signature);

      const rec: Rec = { _row: r };
      for (const c of cols) {
        const cell = raw[c.index] ?? "";
        if (isBlank(cell)) {
          c.q.missing++;
          rec[c.field.id] = null;
          continue;
        }
        let value: Value;
        if (c.field.type === "date") value = parseDate(c.serial && parseNumber(cell) !== null ? excelSerialToIso(parseNumber(cell)!) : cell, c.order);
        else if (c.field.type === "number" || c.field.type === "integer") value = parseNumber(cell);
        else value = cell.trim().replace(/\s+/g, " ");
        if (value === null) {
          c.q.invalid++;
          if (c.q.invalidExamples.length < 3 && !c.q.invalidExamples.includes(cell)) c.q.invalidExamples.push(cell);
        }
        rec[c.field.id] = value;
      }

      for (const f of needs) {
        if (present.has(f) && !has(rec, f)) {
          drop(isBlank(raw[cols.find((c) => c.field.id === f)!.index] ?? "") ? "missing" : "invalid", f, r);
          continue rows;
        }
      }
      for (const c of cols) {
        if (c.field.type !== "date" || !has(rec, c.field.id)) continue;
        const t = rec[c.field.id] as number;
        // Orders and spend cannot lie in the future; deliveries and returns may be scheduled a little ahead.
        const horizon = tableId === "orders" || tableId === "marketing" ? 2 : 90;
        if (t < EARLIEST || t > now + horizon * 86400000) {
          if (needs.includes(c.field.id)) {
            drop("impossible", c.field.id, r);
            continue rows;
          }
          rec[c.field.id] = null;
          c.q.invalid++;
        }
      }

      if (tableId === "orders") {
        if (!has(rec, "unit_price") && !has(rec, "amount")) {
          drop(present.has("unit_price") || present.has("amount") ? "missing" : "invalid", present.has("unit_price") ? "unit_price" : "amount", r);
          continue;
        }
        const q = num(rec, "quantity");
        if ((q !== null && q <= 0) || (num(rec, "unit_price") ?? 0) < 0 || (num(rec, "amount") ?? 0) < 0) {
          drop("impossible", q !== null && q <= 0 ? "quantity" : has(rec, "unit_price") ? "unit_price" : "amount", r);
          continue;
        }
      }
      if (tableId === "marketing" && (num(rec, "spend") ?? 0) < 0) {
        drop("impossible", "spend", r);
        continue;
      }

      // Reference tables hold one row per key; a repeated key keeps its first row.
      const keyField = tableId === "customers" ? "customer_id" : tableId === "products" ? "product_id" : tableId === "delivery" || tableId === "returns" ? "order_id" : null;
      if (keyField) {
        const key = joinKey(keyField)(String(rec[keyField]));
        if (keyed.has(key)) {
          drop("duplicate", keyField, r);
          continue;
        }
        keyed.set(key, r);
      }
      records.push(rec);
    }

    out.records[tableId] = records;
    out.sources[tableId] = source;
    out.headers[tableId] = Object.fromEntries(cols.map((c) => [c.field.id, c.q.header]));
    out.rowsRead[tableId] = source.rows.length;
    out.quality.push(...cols.map((c) => c.q));
    for (const [key, rows] of reject) {
      const [reason, field] = key.split("|");
      out.rejections.push({ table: tableId, reason: reason as Rejection["reason"], field: field || undefined, rows });
    }
  }
  return out;
}

/** RELATIONSHIPS — how the uploaded files connect, and how completely. */
export interface Relationship {
  child: TableId;
  childField: string;
  parent: TableId;
  parentField: string;
  /** Child rows that carry a key. */
  total: number;
  /** Child rows whose key exists in the parent. */
  matched: number;
  rate: number;
  /** Source rows of the child that point at nothing. */
  orphans: number[];
}

export function findRelationships(x: Extracted): Relationship[] {
  const out: Relationship[] = [];
  for (const [child, childField, parent, parentField] of RELATIONS) {
    const c = x.records[child];
    const p = x.records[parent];
    if (!c || !p || !x.headers[child]?.[childField] || !x.headers[parent]?.[parentField]) continue;
    const key = joinKey(parentField);
    const keys = new Set<string>();
    for (const rec of p) if (rec[parentField] !== null) keys.add(key(String(rec[parentField])));
    let total = 0;
    let matched = 0;
    const orphans: number[] = [];
    for (const rec of c) {
      if (rec[childField] === null || rec[childField] === undefined) continue;
      total++;
      if (keys.has(key(String(rec[childField])))) matched++;
      else orphans.push(rec._row);
    }
    out.push({ child, childField, parent, parentField, total, matched, rate: total ? matched / total : 0, orphans });
  }
  return out;
}

/** Tables the user did not provide, most important first. */
export const missingTables = (x: Extracted): TableId[] => TABLES.filter((t) => !x.records[t.id]).map((t) => t.id);
