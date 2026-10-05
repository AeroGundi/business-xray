import type { RawTable } from "./parse";
import { type DateOrder, detectDateOrder, isBlank, knownCountry, normalise, parseDate, parseNumber } from "./values";

/**
 * SCHEMA DETECTION, step 1 — column profiling.
 * Describes what each column contains, independently of what it is called:
 * data type, completeness, cardinality and value patterns.
 */

export interface Profile {
  index: number;
  header: string;
  /** Normalised header, used for name matching. */
  key: string;
  rows: number;
  filled: number;
  distinct: number;
  /** distinct / filled: 1 for a key, low for a category. */
  uniqueness: number;
  dateRate: number;
  numberRate: number;
  integerRate: number;
  countryRate: number;
  /** Share of values that look like codes: short, no spaces, containing a digit. */
  codeRate: number;
  /** Whole numbers in the range Excel uses for dates of this century. */
  serialDates: boolean;
  min: number;
  max: number;
  median: number;
  avgLength: number;
  dateOrder: DateOrder;
  /** Day/month order could not be decided from the values. */
  dateAmbiguous: boolean;
  kind: "date" | "number" | "text" | "empty";
  samples: string[];
}

/** Rows examined per column; large files are sampled at an even stride. */
const SAMPLE = 4000;

export function sampleRows(table: RawTable, max = SAMPLE): string[][] {
  if (table.rows.length <= max) return table.rows;
  const stride = table.rows.length / max;
  return Array.from({ length: max }, (_, i) => table.rows[Math.floor(i * stride)]);
}

export function profileTable(table: RawTable): Profile[] {
  const rows = sampleRows(table);
  return table.headers.map((header, index) => {
    const values = rows.map((r) => r[index] ?? "").filter((v) => !isBlank(v));
    const { order, ambiguous } = detectDateOrder(values);
    const numbers: number[] = [];
    let dates = 0;
    let integers = 0;
    let countries = 0;
    let codes = 0;
    let length = 0;
    const distinct = new Set<string>();
    for (const v of values) {
      distinct.add(v);
      length += v.length;
      const n = parseNumber(v);
      if (n !== null) {
        numbers.push(n);
        if (Number.isInteger(n)) integers++;
      }
      // A bare number is never read as a date, so "20240131"-style ids stay ids.
      if (n === null && parseDate(v, order) !== null) dates++;
      if (knownCountry(v)) countries++;
      if (v.length <= 24 && !/\s/.test(v) && /\d/.test(v)) codes++;
    }
    const filled = values.length;
    const rate = (x: number) => (filled ? x / filled : 0);
    // Cardinality is counted on every row: a sample would make repeated keys look unique.
    const all = new Set<string>();
    let allFilled = 0;
    for (const r of table.rows) {
      const v = r[index] ?? "";
      if (isBlank(v)) continue;
      allFilled++;
      all.add(v);
    }
    numbers.sort((a, b) => a - b);
    const numberRate = rate(numbers.length);
    const dateRate = rate(dates);
    return {
      index, header, key: normalise(header), rows: rows.length, filled, distinct: all.size, uniqueness: allFilled ? all.size / allFilled : 0,
      dateRate, numberRate, integerRate: rate(integers), countryRate: rate(countries), codeRate: rate(codes),
      serialDates: numberRate > 0.95 && rate(integers) > 0.95 && numbers.length > 0 && numbers[0] >= 30000 && numbers[numbers.length - 1] <= 60000,
      min: numbers[0] ?? NaN, max: numbers[numbers.length - 1] ?? NaN, median: numbers[Math.floor(numbers.length / 2)] ?? NaN,
      avgLength: rate(length), dateOrder: order, dateAmbiguous: ambiguous && dateRate > 0.8,
      kind: filled === 0 ? "empty" : dateRate >= 0.8 ? "date" : numberRate >= 0.9 ? "number" : "text",
      samples: [...distinct].slice(0, 3),
    };
  });
}
