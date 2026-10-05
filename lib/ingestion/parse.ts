import { strFromU8, unzipSync } from "fflate";

/**
 * INGESTION — reading files into raw tables.
 *
 * Every source (a CSV file, or one sheet of an Excel workbook) becomes a
 * `RawTable`: a header row and string cells. Nothing is interpreted here;
 * types and meaning are inferred later, in lib/ingestion/profile and detect.
 */

export interface RawTable {
  /** Stable id within the session. */
  id: string;
  /** File name, with the sheet name appended for workbooks with several sheets. */
  name: string;
  format: "csv" | "xlsx";
  bytes: number;
  headers: string[];
  rows: string[][];
  /** Notes produced while reading, in plain language. */
  notes: string[];
}

export type ParseErrorCode = "unsupported" | "unreadable" | "empty";

export class ParseError extends Error {
  constructor(public code: ParseErrorCode, message: string) {
    super(message);
  }
}

export const ERROR_TEXT: Record<ParseErrorCode, { title: string; fix: string }> = {
  unsupported: { title: "BUSINESS X-RAY currently supports CSV and Excel files.", fix: "Export this data as .csv or .xlsx and add it again." },
  unreadable: { title: "This file could not be read.", fix: "Open it in your spreadsheet program, save it again as CSV, and add it again." },
  empty: { title: "This file contains no usable records.", fix: "Check that the first row holds column names and that there is at least one row of data beneath it." },
};

const DELIMITERS = [",", ";", "\t", "|"];

/** Picks the delimiter that splits the first lines into the most consistent number of fields. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = counts[0] > 1 ? counts[0] * consistent * consistent : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** RFC 4180 CSV reader: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Excel number formats that display a date (built-in ids, ECMA-376 §18.8.30). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

const decodeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

/** Excel serial day number → ISO date (1900 date system, including its leap-year quirk). */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

const columnIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
};

/** Minimal .xlsx reader: shared strings, inline strings, numbers and date-formatted cells of every sheet. */
export function parseXlsx(bytes: Uint8Array): { sheet: string; rows: string[][] }[] {
  const zip = unzipSync(bytes);
  const read = (path: string): string | null => (zip[path] ? strFromU8(zip[path]) : null);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new ParseError("unreadable", "Not an Excel workbook");

  const shared: string[] = [];
  for (const m of (read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  }

  const styles = read("xl/styles.xml") ?? "";
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(+m[1], m[2]);
  const xfs = [...(styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "").matchAll(/<xf [^>]*numFmtId="(\d+)"/g)].map((m) => +m[1]);
  const isDate = xfs.map((id) => DATE_FORMAT_IDS.has(id) || /[dy]/i.test((custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "")));

  const rels = new Map<string, string>();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship [^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets: { sheet: string; rows: string[][] }[] = [];
  for (const m of workbook.matchAll(/<sheet [^>]*>/g)) {
    const name = decodeXml(m[0].match(/name="([^"]*)"/)?.[1] ?? "Sheet");
    const xml = read(rels.get(m[0].match(/r:id="([^"]+)"/)?.[1] ?? "") ?? "");
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const col = columnIndex(attrs.match(/r="([A-Z]+)\d+"/)?.[1] ?? "");
        const type = attrs.match(/t="(\w+)"/)?.[1];
        const style = +(attrs.match(/s="(\d+)"/)?.[1] ?? -1);
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        let value = "";
        if (type === "s") value = shared[+v] ?? "";
        else if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
        else if (type === "b") value = v === "1" ? "true" : "false";
        else if (v !== "" && isDate[style] && Number.isFinite(+v)) value = excelSerialToIso(+v);
        else value = decodeXml(v);
        while (row.length < (col >= 0 ? col : row.length)) row.push("");
        row[col >= 0 ? col : row.length] = value;
      }
      rows.push(row);
    }
    sheets.push({ sheet: name, rows });
  }
  return sheets;
}

let counter = 0;

/** Turns a grid of cells into a table: first non-empty row is the header, blank rows and columns are dropped. */
export function toTable(name: string, format: RawTable["format"], bytes: number, grid: string[][]): RawTable {
  const cells = grid.map((r) => r.map((c) => (c ?? "").trim()));
  const first = cells.findIndex((r) => r.some((c) => c !== ""));
  if (first < 0) throw new ParseError("empty", name);
  const notes: string[] = [];
  const width = Math.max(...cells.slice(first).map((r) => r.length));
  const keep: number[] = [];
  for (let c = 0; c < width; c++) if (cells.slice(first).some((r) => (r[c] ?? "") !== "")) keep.push(c);

  const seen = new Map<string, number>();
  const headers = keep.map((c, i) => {
    const raw = cells[first][c] || `Column ${i + 1}`;
    const n = (seen.get(raw.toLowerCase()) ?? 0) + 1;
    seen.set(raw.toLowerCase(), n);
    return n > 1 ? `${raw} (${n})` : raw;
  });
  const repeated = [...seen].filter(([, n]) => n > 1).length;
  if (repeated) notes.push(`${repeated} column name${repeated > 1 ? "s appear" : " appears"} more than once; the repeats were numbered.`);

  const rows = cells.slice(first + 1).filter((r) => r.some((c) => c !== "")).map((r) => keep.map((c) => r[c] ?? ""));
  if (rows.length === 0) throw new ParseError("empty", name);
  return { id: `t${++counter}`, name, format, bytes, headers, rows, notes };
}

const decode = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Spreadsheets on Windows often export Latin-1.
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

/** Reads one uploaded file into one table per sheet. Throws ParseError with a user-facing code. */
export function readFile(name: string, bytes: Uint8Array): RawTable[] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    let grid: string[][];
    try {
      grid = parseCsv(decode(bytes));
    } catch {
      throw new ParseError("unreadable", name);
    }
    return [toTable(name, "csv", bytes.length, grid)];
  }
  if (ext === "xlsx" || ext === "xlsm") {
    let sheets: ReturnType<typeof parseXlsx>;
    try {
      sheets = parseXlsx(bytes);
    } catch {
      throw new ParseError("unreadable", name);
    }
    const tables: RawTable[] = [];
    for (const s of sheets) {
      try {
        tables.push(toTable(sheets.length > 1 ? `${name} › ${s.sheet}` : name, "xlsx", bytes.length, s.rows));
      } catch {
        // Empty sheets in a workbook are simply skipped.
      }
    }
    if (tables.length === 0) throw new ParseError("empty", name);
    return tables;
  }
  throw new ParseError("unsupported", name);
}
