import type { RawTable } from "./parse";
import { type Profile, profileTable, sampleRows } from "./profile";
import { type Field, RELATIONS, TABLE, TABLES, type TableId } from "./schema";
import { isBlank, keyOf, normalise } from "./values";

/**
 * SCHEMA DETECTION, step 2 — mapping user columns onto the canonical model.
 *
 * For every (column, canonical field) pair three kinds of evidence are scored
 * in [0, 1]:
 *
 *   name   how closely the header matches the field's vocabulary
 *          (exact, token overlap, or spelling similarity);
 *   type   whether the values have the data type the field requires —
 *          an incompatible type vetoes the pair outright;
 *   value  whether the values behave like the field: cardinality, range,
 *          uniqueness, country names, code patterns.
 *
 *   confidence = 0.62·name + 0.20·type + 0.18·value        (WEIGHTS)
 *
 * Columns are then assigned to fields greedily in order of confidence, one
 * column per field. Columns with no usable name can still be mapped from
 * values alone (a column of country names, the only date column) or from a
 * relationship (its values are keys of another file) — always below the
 * confirmation threshold, so the user is asked.
 *
 * The method is deterministic and uses no language model: every confidence
 * can be traced back to the three scores, which are shown as reasons.
 */

export const WEIGHTS = { name: 0.62, type: 0.2, value: 0.18 };
export const CONFIDENCE = {
  /** Below this, a mapping is not proposed at all. */
  propose: 0.5,
  /** Below this, the user must confirm the mapping before it is used. */
  confirm: 0.8,
  /** At or above this, the mapping is shown as high confidence. */
  high: 0.95,
  /** Two columns within this margin for the same field are reported as ambiguous. */
  ambiguity: 0.08,
  /** A file is recognised as a table when its mapping scores at least this. */
  table: 0.3,
};

export interface ColumnMatch {
  column: number;
  field: string | null;
  confidence: number;
  /** Plain-language evidence behind the mapping. */
  reasons: string[];
  /** Another column that could equally be this field. */
  rival?: number;
  /** The user has confirmed or chosen this mapping. */
  confirmed: boolean;
}

export interface SourceMapping {
  source: string;
  table: TableId | null;
  /** How well the file fits the table it was recognised as. */
  score: number;
  columns: ColumnMatch[];
}

export const needsConfirmation = (m: ColumnMatch): boolean => m.field !== null && !m.confirmed && (m.confidence < CONFIDENCE.confirm || m.rival !== undefined);
export const band = (confidence: number): "high" | "medium" | "low" => (confidence >= CONFIDENCE.high ? "high" : confidence >= CONFIDENCE.confirm ? "medium" : "low");

const bigrams = (s: string): string[] => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));

/** Sørensen–Dice similarity of character bigrams: tolerant of typos and abbreviations. */
export function dice(a: string, b: string): number {
  const x = bigrams(a.replace(/ /g, ""));
  const y = bigrams(b.replace(/ /g, ""));
  if (!x.length || !y.length) return 0;
  const pool = [...y];
  let hits = 0;
  for (const g of x) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hits++;
      pool.splice(i, 1);
    }
  }
  return (2 * hits) / (x.length + y.length);
}

export function nameScore(key: string, field: Field): { score: number; via: string } {
  const tokens = new Set(key.split(" "));
  let best = { score: 0, via: "" };
  for (const raw of [field.id.replace(/_/g, " "), ...field.names]) {
    const name = normalise(raw);
    const parts = name.split(" ");
    let score = 0;
    if (name === key) score = 1;
    else if (parts.length === tokens.size && parts.every((p) => tokens.has(p))) score = 1;
    else if (parts.every((p) => tokens.has(p))) score = 0.6 + (0.3 * parts.length) / tokens.size;
    else if ([...tokens].every((t) => parts.includes(t))) score = 0.55 + (0.3 * tokens.size) / parts.length;
    else {
      const d = dice(key, name);
      if (d >= 0.72) score = 0.75 * d;
    }
    if (score > best.score) best = { score, via: raw };
  }
  return best;
}

function typeScore(p: Profile, field: Field): number {
  switch (field.type) {
    case "date": return p.dateRate >= 0.6 ? p.dateRate : p.serialDates ? 0.7 : 0;
    case "number": return p.numberRate >= 0.8 ? p.numberRate : 0;
    case "integer": return p.numberRate >= 0.8 ? 0.5 * p.numberRate + 0.5 * p.integerRate : 0;
    case "country": return p.kind === "text" ? 1 : 0;
    case "id": return p.kind === "date" ? 0 : 1;
    default: return p.kind === "text" ? 1 : p.kind === "date" ? 0 : 0.5;
  }
}

/** Does the column behave like the field? 0.6 is neutral. */
function valueScore(p: Profile, field: Field, table: TableId): number {
  const key = field.id;
  const isParentKey = (table === "customers" && key === "customer_id") || (table === "products" && key === "product_id");
  if (isParentKey) return p.uniqueness >= 0.98 ? 1 : 0.2;
  if (key === "order_id") return table === "orders" ? (p.uniqueness >= 0.4 ? 1 : 0.4) : p.uniqueness >= 0.9 ? 1 : 0.5;
  if (key === "customer_id" || key === "product_id") return p.avgLength > 48 ? 0.2 : p.uniqueness < 0.98 ? (p.codeRate > 0.5 || p.kind === "text" ? 1 : 0.8) : 0.5;
  if (key === "quantity") return p.integerRate >= 0.95 && p.min >= 0 && p.median <= 50 ? 1 : 0.2;
  if (key === "unit_price" || key === "amount" || key === "spend" || key === "cost" || key === "unit_cost" || key === "shipping_cost") return p.min >= 0 ? (p.max > 0 ? 1 : 0.5) : 0.3;
  if (key === "discount") return p.min >= 0 && p.max <= 100 ? 1 : p.min >= 0 ? 0.6 : 0.2;
  if (field.type === "country") return p.countryRate;
  if (field.type === "date") return p.dateRate;
  if (key === "segment" || key === "channel" || key === "acquisition_channel" || key === "category") return p.distinct <= 60 && p.uniqueness < 0.5 ? 1 : 0.3;
  if (key === "product_name") return p.kind === "text" && p.avgLength >= 3 ? 0.9 : 0.4;
  return 0.6;
}

interface Scored {
  column: number;
  field: Field;
  confidence: number;
  reasons: string[];
}

const describeValues = (p: Profile, field: Field): string =>
  field.type === "date" ? "values are dates"
    : field.type === "country" ? `${Math.round(p.countryRate * 100)}% of values are country names or codes`
    : field.type === "number" || field.type === "integer" ? "values are numbers in a plausible range"
    : p.uniqueness >= 0.98 ? "every value is different, like an identifier"
    : `${p.distinct.toLocaleString("en-GB")} distinct values`;

function scorePair(p: Profile, field: Field, table: TableId): Scored | null {
  if (p.kind === "empty") return null;
  const type = typeScore(p, field);
  if (type === 0) return null;
  const name = nameScore(p.key, field);
  const value = valueScore(p, field, table);
  if (name.score > 0) {
    const confidence = Math.min(0.99, WEIGHTS.name * name.score + WEIGHTS.type * type + WEIGHTS.value * value);
    const reasons = [name.score === 1 ? `name matches “${name.via}”` : `name resembles “${name.via}”`];
    if (value >= 0.8) reasons.push(describeValues(p, field));
    else if (value < 0.5) reasons.push("values are unusual for this field");
    return { column: p.index, field, confidence, reasons };
  }
  // No usable name: a column of countries is recognisable from its values alone.
  if (field.type === "country" && p.countryRate >= 0.9) {
    return { column: p.index, field, confidence: 0.7, reasons: ["name not recognised", describeValues(p, field)] };
  }
  return null;
}

/** Best one-to-one assignment of a file's columns to the fields of one table. */
export function mapColumns(profiles: Profile[], table: TableId): ColumnMatch[] {
  const pairs: Scored[] = [];
  for (const p of profiles) for (const field of TABLE[table].fields) {
    const s = scorePair(p, field, table);
    if (s && s.confidence >= CONFIDENCE.propose) pairs.push(s);
  }
  pairs.sort((a, b) => b.confidence - a.confidence);
  const byColumn = new Map<number, Scored>();
  const byField = new Map<string, Scored>();
  for (const s of pairs) {
    if (byColumn.has(s.column) || byField.has(s.field.id)) continue;
    byColumn.set(s.column, s);
    byField.set(s.field.id, s);
  }

  // The only date column of a file that still needs a date is that date.
  const dates = profiles.filter((p) => p.kind === "date" || p.serialDates);
  const openDate = TABLE[table].fields.find((f) => f.type === "date" && f.level !== "extra" && !byField.has(f.id));
  if (openDate && dates.length === 1 && !byColumn.has(dates[0].index)) {
    const s: Scored = { column: dates[0].index, field: openDate, confidence: 0.7, reasons: ["name not recognised", "the only date column in the file"] };
    byColumn.set(s.column, s);
    byField.set(openDate.id, s);
  }

  return profiles.map((p) => {
    const s = byColumn.get(p.index);
    if (!s) return { column: p.index, field: null, confidence: 0, reasons: [], confirmed: false };
    // Ambiguity: another column scores almost as well for the same field (it may have been given to a different field, or to none).
    const rival = pairs.find((o) => o.field.id === s.field.id && o.column !== s.column && s.confidence - o.confidence <= CONFIDENCE.ambiguity && byColumn.get(o.column)?.field.id === undefined);
    return { column: s.column, field: s.field.id, confidence: s.confidence, reasons: s.reasons, rival: rival?.column, confirmed: false };
  });
}

/** How well a set of matches covers a table: confidence-weighted share of its required and core fields. */
export function tableScore(matches: ColumnMatch[], table: TableId, fileName: string, profiles: Profile[]): number {
  const weight = { required: 3, core: 2, extra: 0 };
  let got = 0;
  let all = 0;
  for (const field of TABLE[table].fields) {
    all += weight[field.level];
    const m = matches.find((x) => x.field === field.id) ?? (field.id === "unit_price" ? matches.find((x) => x.field === "amount") : undefined);
    if (m) got += weight[field.level] * m.confidence;
  }
  const tokens = normalise(fileName.replace(/\.[a-z]+$/i, "")).split(" ");
  const named = TABLE[table].fileNames.some((n) => tokens.includes(n));
  const found = (id: string) => matches.find((m) => m.field === id);
  // A line total can stand in for the unit price.
  const requiredFound = TABLE[table].fields.filter((x) => x.level === "required").every((x) => found(x.id) || (x.id === "unit_price" && found("amount")));
  // A reference table lists each of its keys once; a file that repeats them is not that table.
  const ownKey = table === "customers" ? found("customer_id") : table === "products" ? found("product_id") : undefined;
  const repeatsKey = ownKey !== undefined && profiles[ownKey.column].uniqueness < 0.9;
  return Math.min(1, got / all + (named ? 0.2 : 0)) * (requiredFound || named ? 1 : 0.6) * (repeatsKey ? 0.4 : 1);
}

export interface Detection {
  profiles: Record<string, Profile[]>;
  mappings: SourceMapping[];
}

/** Identifiers are compared as written (ignoring case); names such as channels are compared in normalised form. */
export const joinKey = (field: string): ((s: string) => string) => (field.endsWith("_id") ? keyOf : normalise);

const keySet = (table: RawTable, column: number, key: (s: string) => string, limit = Infinity): Set<string> => {
  const out = new Set<string>();
  const rows = limit === Infinity ? table.rows : sampleRows(table, limit);
  for (const r of rows) if (!isBlank(r[column] ?? "")) out.add(key(r[column]));
  return out;
};

/** Share of a child column's values that exist in the parent key set. */
export function containment(child: RawTable, column: number, parent: Set<string>, key: (s: string) => string, limit = 3000): number {
  const keys = keySet(child, column, key, limit);
  if (keys.size === 0) return 0;
  let hits = 0;
  for (const k of keys) if (parent.has(k)) hits++;
  return hits / keys.size;
}

/** A link field that names could not find is recovered when a free column's values are keys of the other file. */
function inferFromRelationships(tables: RawTable[], mappings: SourceMapping[]): void {
  const find = (id: TableId) => mappings.find((m) => m.table === id);
  for (const [childId, childField, parentId, parentField] of RELATIONS) {
    const child = find(childId);
    const parent = find(parentId);
    if (!child || !parent || child.columns.some((c) => c.field === childField)) continue;
    const parentColumn = parent.columns.find((c) => c.field === parentField);
    if (!parentColumn) continue;
    const parentTable = tables.find((t) => t.id === parent.source)!;
    const childTable = tables.find((t) => t.id === child.source)!;
    const keys = keySet(parentTable, parentColumn.column, joinKey(parentField));
    let best: { column: number; rate: number } | null = null;
    for (const c of child.columns) {
      if (c.field !== null) continue;
      const rate = containment(childTable, c.column, keys, joinKey(parentField));
      if (rate >= 0.8 && (!best || rate > best.rate)) best = { column: c.column, rate };
    }
    if (best) {
      child.columns[best.column] = {
        column: best.column, field: childField, confidence: 0.55 + 0.24 * best.rate, confirmed: false,
        reasons: ["name not recognised", `${Math.round(best.rate * 100)}% of its values exist in ${TABLE[parentId].label.toLowerCase()} › ${parentTable.headers[parentColumn.column]}`],
      };
    }
  }
}

/** Recognises what each file is and how its columns map onto the canonical model. */
export function detectSchema(tables: RawTable[]): Detection {
  const profiles: Record<string, Profile[]> = {};
  const candidates = tables.map((t) => {
    profiles[t.id] = profileTable(t);
    const options = TABLES.map((def) => {
      const columns = mapColumns(profiles[t.id], def.id);
      return { table: def.id, columns, score: tableScore(columns, def.id, t.name, profiles[t.id]) };
    }).sort((a, b) => b.score - a.score);
    return { source: t, options };
  });

  // Strongest claims first; a table is given to one file only.
  const taken = new Set<TableId>();
  const mappings = new Map<string, SourceMapping>();
  const order = [...candidates].sort((a, b) => b.options[0].score - a.options[0].score || b.source.rows.length - a.source.rows.length);
  for (const c of order) {
    const pick = c.options.find((o) => o.score >= CONFIDENCE.table && !taken.has(o.table));
    if (pick) taken.add(pick.table);
    mappings.set(c.source.id, pick
      ? { source: c.source.id, table: pick.table, score: pick.score, columns: pick.columns }
      : { source: c.source.id, table: null, score: 0, columns: profiles[c.source.id].map((p) => ({ column: p.index, field: null, confidence: 0, reasons: [], confirmed: false })) });
  }
  const result = tables.map((t) => mappings.get(t.id)!);
  inferFromRelationships(tables, result);
  return { profiles, mappings: result };
}

/** Re-maps one file as a different table (the user's choice). */
export function remapAs(profiles: Profile[], source: string, table: TableId | null): SourceMapping {
  if (!table) return { source, table: null, score: 0, columns: profiles.map((p) => ({ column: p.index, field: null, confidence: 0, reasons: [], confirmed: false })) };
  const columns = mapColumns(profiles, table);
  return { source, table, score: 1, columns };
}

/** Applies a user's choice for one column. A field can belong to one column only, so its previous holder is released. */
export function assignField(mapping: SourceMapping, column: number, field: string | null): SourceMapping {
  return {
    ...mapping,
    columns: mapping.columns.map((c) =>
      c.column === column ? { column, field, confidence: field ? 1 : 0, reasons: field ? ["chosen by you"] : [], confirmed: true }
        : field !== null && c.field === field ? { column: c.column, field: null, confidence: 0, reasons: [], confirmed: true }
        : c.rival === column ? { ...c, rival: undefined } : c),
  };
}

export const confirmColumn = (mapping: SourceMapping, column: number): SourceMapping =>
  ({ ...mapping, columns: mapping.columns.map((c) => (c.column === column ? { ...c, confirmed: true, rival: undefined } : c)) });
