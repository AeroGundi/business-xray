import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { computeHealth } from "@/lib/analytics/health";
import { generateDataset } from "@/lib/data/generate";
import { assignField, band, confirmColumn, detectSchema, needsConfirmation, remapAs } from "@/lib/ingestion/detect";
import { ParseError, type RawTable, parseCsv, readFile, toTable } from "@/lib/ingestion/parse";
import { evaluate } from "@/lib/ingestion/pipeline";
import { type Sheet, datasetToSheets, templateSheet, templateZip, toCsv } from "@/lib/ingestion/templates";
import { TABLES, type TableId } from "@/lib/ingestion/schema";
import { parseDate, parseNumber } from "@/lib/ingestion/values";
import { detectFindings } from "@/lib/insights/findings";
import { canSimulate } from "@/lib/simulation/model";

const nova = generateDataset();
const sheets = datasetToSheets(nova);
const table = (name: string, sheet: Sheet): RawTable => toTable(name, "csv", 0, parseCsv(toCsv(sheet)));
const run = (tables: RawTable[]) => {
  const detection = detectSchema(tables);
  return { detection, tables, ...evaluate(tables, detection.mappings, detection.profiles) };
};
const mapped = (r: ReturnType<typeof run>, source: number) =>
  Object.fromEntries(r.detection.mappings[source].columns.filter((c) => c.field).map((c) => [r.tables[source].headers[c.column], c]));
/** Renames and reorders columns of a sheet. */
const rename = (sheet: Sheet, names: Record<string, string | null>): Sheet => {
  const keep = sheet.headers.map((h, i) => ({ h, i })).filter(({ h }) => names[h] !== null);
  return { headers: keep.map(({ h }) => names[h] ?? h), rows: sheet.rows.map((r) => keep.map(({ i }) => r[i])) };
};

describe("parsing", () => {
  it("reads quoted CSV fields, semicolon delimiters and a byte-order mark", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("﻿a;b\n1,5;2\n")).toEqual([["a", "b"], ["1,5", "2"]]);
  });
  it("reads numbers and dates in European and US notation", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("€ 79,90")).toBe(79.9);
    expect(parseNumber("abc")).toBeNull();
    expect(parseDate("2025-01-03")).toBe(Date.UTC(2025, 0, 3));
    expect(parseDate("03/01/2025")).toBe(Date.UTC(2025, 0, 3));
    expect(parseDate("01/03/2025", "mdy")).toBe(Date.UTC(2025, 0, 3));
    expect(parseDate("3 ene 2025")).toBe(Date.UTC(2025, 0, 3));
    expect(parseDate("31/02/2025")).toBeNull();
  });
  it("reads an Excel workbook, including date-formatted cells", () => {
    const xml = (s: string) => strToU8(`<?xml version="1.0"?>${s}`);
    const book = zipSync({
      "xl/workbook.xml": xml('<workbook><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/styles.xml": xml('<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
      "xl/sharedStrings.xml": xml("<sst><si><t>order_date</t></si><si><t>unit_price</t></si></sst>"),
      "xl/worksheets/sheet1.xml": xml('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="1"><v>45660</v></c><c r="B2"><v>79.9</v></c></row></sheetData></worksheet>'),
    });
    const [t] = readFile("orders.xlsx", book);
    expect(t.headers).toEqual(["order_date", "unit_price"]);
    expect(t.rows[0]).toEqual(["2025-01-03", "79.9"]);
  });
  it("rejects unsupported and empty files with a specific error", () => {
    expect(() => readFile("orders.pdf", new Uint8Array(4))).toThrow(ParseError);
    expect(() => readFile("orders.csv", strToU8("a,b\n"))).toThrowError(expect.objectContaining({ code: "empty" }));
    expect(() => readFile("orders.xlsx", strToU8("not a zip"))).toThrowError(expect.objectContaining({ code: "unreadable" }));
  });
  it("ships a template for every table", () => {
    expect(templateZip().length).toBeGreaterThan(500);
    for (const t of TABLES) expect(templateSheet(t.id).rows[0]).toHaveLength(templateSheet(t.id).headers.length);
  });
});

describe("Scenario A — perfect data (the demo business in template format)", () => {
  const all = run(TABLES.map((t) => table(`${t.id}.csv`, sheets[t.id])));

  it("recognises every file and maps every column with high confidence", () => {
    expect(all.detection.mappings.map((m) => m.table)).toEqual(TABLES.map((t) => t.id));
    for (const m of all.detection.mappings) for (const c of m.columns) {
      expect(c.field).not.toBeNull();
      expect(band(c.confidence)).not.toBe("low");
      if (c.field!.endsWith("_id") || c.field!.endsWith("_date")) expect(band(c.confidence)).toBe("high");
    }
  });
  it("finds the relationships between files, all intact", () => {
    expect(all.relationships).toHaveLength(5);
    for (const r of all.relationships) expect(r.rate).toBe(1);
  });
  it("normalises into the same business the engine saw originally", () => {
    const data = all.normalised.data!;
    expect(data.weeks).toBe(nova.weeks);
    expect(data.orders.length).toBe(nova.orders.length);
    const revenue = (d: typeof data) => d.orders.reduce((s, o) => s + o.revenue, 0);
    expect(revenue(data) / revenue(nova)).toBeCloseTo(1, 3);
    expect(canSimulate(data)).toBe(true);
    expect(all.issues.filter((i) => i.level === "blocker")).toEqual([]);
  });
  it("feeds the existing engine, which rediscovers the same findings", () => {
    const data = all.normalised.data!;
    const original = detectFindings(nova);
    const uploaded = detectFindings(data);
    expect(uploaded.map((f) => f.id)).toEqual(original.map((f) => f.id));
    const revenue = uploaded.find((f) => f.id === "revenue")!;
    expect(revenue.investigation.leafScope).toEqual(original.find((f) => f.id === "revenue")!.investigation.leafScope);
    expect(revenue.investigation.drivers[0].metric).toBe("delivery");
    expect(Math.abs(computeHealth(data, uploaded).score - computeHealth(nova, original).score)).toBeLessThanOrEqual(3);
  });
  it("scores readiness from documented dimensions", () => {
    const r = all.readiness!;
    expect(r.dimensions.map((d) => d.id)).toEqual(["coverage", "quality", "relationships", "temporal", "analytical"]);
    expect(r.dimensions.find((d) => d.id === "temporal")!.score).toBeCloseTo(78 / 104, 5);
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.capabilities.every((c) => c.status !== "unavailable")).toBe(true);
  });
});

describe("Scenario B — Spanish column names in a single file", () => {
  const es = rename(sheets.orders, {
    order_id: "Nº Pedido", customer_id: "Cliente", product_id: "Producto", order_date: "Fecha pedido", quantity: "Unidades",
    unit_price: "Precio", discount: "Descuento", country: "País", shipping_cost: null,
  });
  const r = run([table("ventas_2025.csv", es)]);
  it("understands the columns", () => {
    const m = mapped(r, 0);
    expect(r.detection.mappings[0].table).toBe("orders");
    expect(m["Cliente"].field).toBe("customer_id");
    expect(m["Fecha pedido"].field).toBe("order_date");
    expect(m["Precio"].field).toBe("unit_price");
    expect(m["Unidades"].field).toBe("quantity");
    expect(m["País"].field).toBe("country");
    expect(m["Producto"].field).toBe("product_id");
    for (const c of Object.values(m)) expect(c.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("runs with what one file can support and says what is missing", () => {
    const a = r.normalised.availability!;
    expect(a.metrics).toEqual(expect.arrayContaining(["revenue", "repurchase", "discount"]));
    expect(a.metrics).not.toEqual(expect.arrayContaining(["margin"]));
    expect(a.dims.orders).toEqual(["country", "product"]);
    expect(r.readiness!.capabilities.find((c) => c.id === "profit")!.status).toBe("unavailable");
    expect(r.readiness!.dimensions.find((d) => d.id === "relationships")!.score).toBeNull();
    expect(detectFindings(r.normalised.data!).some((f) => f.id === "revenue")).toBe(true);
  });
});

describe("Scenario C — different naming, line total instead of price", () => {
  const sheet: Sheet = {
    headers: ["client", "purchase_date", "amount", "region"],
    rows: sheets.orders.rows.map((o) => [o[1], o[3], Math.round(+o[4] * +o[5] * (1 - +o[6]) * 100) / 100, o[7]]),
  };
  const r = run([table("export.csv", sheet)]);
  it("maps client, purchase date, amount and region", () => {
    const m = mapped(r, 0);
    expect(m.client.field).toBe("customer_id");
    expect(m.purchase_date.field).toBe("order_date");
    expect(m.amount.field).toBe("amount");
    expect(m.region.field).toBe("country");
  });
  it("measures revenue from the line total", () => {
    const revenue = r.normalised.data!.orders.reduce((s, o) => s + o.revenue, 0);
    expect(revenue / nova.orders.reduce((s, o) => s + o.revenue, 0)).toBeCloseTo(1, 3);
    expect(r.issues.some((i) => i.id === "no-product")).toBe(true);
  });
});

describe("Scenario D — optional data missing", () => {
  const r = run((["orders", "customers", "products"] as TableId[]).map((t) => table(`${t}.csv`, sheets[t])));
  it("continues without delivery, marketing and returns", () => {
    expect(r.issues.filter((i) => i.level === "blocker")).toEqual([]);
    expect(r.issues.filter((i) => i.id.startsWith("absent-")).map((i) => i.table)).toEqual(expect.arrayContaining(["delivery", "marketing", "returns"]));
    const caps = Object.fromEntries(r.readiness!.capabilities.map((c) => [c.id, c.status]));
    expect(caps.delivery).toBe("unavailable");
    expect(caps.marketing).toBe("unavailable");
    expect(caps.profit).not.toBe("unavailable");
    expect(caps.whatif).toBe("unavailable");
  });
  it("leaves the unsupported analyses out of the engine's results", () => {
    const data = r.normalised.data!;
    const findings = detectFindings(data);
    expect(findings.map((f) => f.id)).not.toEqual(expect.arrayContaining(["delivery", "marketing"]));
    for (const f of findings) expect(f.investigation.drivers.map((d) => d.metric)).not.toEqual(expect.arrayContaining(["delivery", "returns"]));
    const health = computeHealth(data, findings);
    expect(health.missing.length).toBeGreaterThan(0);
    expect(health.score).toBeGreaterThan(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });
});

describe("Scenario E — a needed field is missing", () => {
  it("continues without customer analysis when there is no customer ID", () => {
    const r = run([table("orders.csv", rename(sheets.orders, { customer_id: null }))]);
    expect(r.issues.find((i) => i.id === "no-customer")?.level).toBe("warning");
    expect(r.normalised.availability!.metrics).not.toContain("repurchase");
    expect(r.readiness!.entities.find((e) => e.id === "customers")!.status).toBe("unavailable");
  });
  it("blocks, with a way forward, when there is no order date", () => {
    const r = run([table("orders.csv", rename(sheets.orders, { order_date: null }))]);
    const blocker = r.issues.find((i) => i.level === "blocker")!;
    expect(blocker.title).toMatch(/could not identify the fields required/);
    expect(blocker.fix).toMatch(/mapping/);
    expect(r.readiness).toBeNull();
  });
  it("blocks when the history is too short", () => {
    const short = { ...sheets.orders, rows: sheets.orders.rows.filter((o) => String(o[3]) >= "2026-06-01") };
    expect(run([table("orders.csv", short)]).issues[0].id).toBe("history");
  });
});

describe("Scenario F — dirty data", () => {
  const rows = sheets.orders.rows.map((o) => [...o]);
  for (let i = 0; i < 400; i++) rows.push([...rows[40000 + i * 7]]);
  for (let i = 0; i < 300; i++) rows[1000 + i * 11][3] = "";
  for (let i = 0; i < 200; i++) rows[5000 + i * 13][3] = "not a date";
  for (let i = 0; i < 150; i++) rows[9000 + i * 17][4] = -1;
  for (let i = 0; i < 2000; i++) {
    const [y, m, d] = String(rows[20000 + i][3]).split("-");
    if (y) rows[20000 + i][3] = `${d}/${m}/${y}`;
  }
  for (let i = 0; i < 500; i++) rows[30000 + i][7] = i % 2 ? "ES" : "españa";
  const customers = { ...sheets.customers, rows: sheets.customers.rows.slice(0, Math.floor(sheets.customers.rows.length * 0.8)) };
  const r = run([table("orders.csv", { ...sheets.orders, rows }), table("customers.csv", customers)]);
  const issue = (id: string) => r.issues.find((i) => i.id === id);

  it("reports duplicates, missing and unreadable dates and impossible values, with counts", () => {
    expect(issue("dup-orders")!.affected).toBe(400);
    expect(issue("missing-orders-order_date")!.affected).toBe(300);
    expect(issue("invalid-orders-order_date")!.affected).toBe(200);
    expect(issue("impossible-orders-quantity")!.affected).toBe(150);
    expect(issue("invalid-orders-order_date")!.sample!.rows[0][3]).toBe("not a date");
  });
  it("reads mixed date formats and merges country spellings", () => {
    expect(r.normalised.data!.orders.length).toBe(nova.orders.length - 300 - 200 - 150);
    expect(new Set(r.normalised.data!.orders.map((o) => o.country)).size).toBe(nova.countries.length);
    expect(issue("spellings")).toBeDefined();
  });
  it("explains broken relationships in plain language and keeps the orders", () => {
    const orphan = issue("orphan-customers")!;
    expect(orphan.title).toBe("Some orders reference customers that are missing from the uploaded data.");
    expect(orphan.affected).toBeGreaterThan(1000);
    expect(r.readiness!.dimensions.find((d) => d.id === "relationships")!.score!).toBeLessThan(0.95);
    expect(r.readiness!.dimensions.find((d) => d.id === "quality")!.score!).toBeLessThan(1);
  });
});

describe("Scenario G — ambiguous mapping", () => {
  const sheet: Sheet = { headers: [...sheets.orders.headers, "purchase_date"], rows: sheets.orders.rows.slice(0, 3000).map((o) => [...o, o[3]]) };
  const r = run([table("orders.csv", sheet)]);
  it("flags two possible order-date columns and asks for confirmation", () => {
    const date = r.detection.mappings[0].columns.find((c) => c.field === "order_date")!;
    expect(date.rival).toBeDefined();
    expect(needsConfirmation(date)).toBe(true);
  });
  it("asks for confirmation when a column is mapped from its values alone", () => {
    const odd = rename(sheets.orders, { country: "col_8", customer_id: "who" });
    const x = run([table("orders.csv", odd), table("customers.csv", sheets.customers)]);
    const m = mapped(x, 0);
    expect(m.col_8.field).toBe("country");
    expect(needsConfirmation(m.col_8)).toBe(true);
    expect(m.who.field).toBe("customer_id");
    expect(m.who.reasons.join(" ")).toMatch(/exist in customers/);
    expect(needsConfirmation(m.who)).toBe(true);
  });
});

describe("user corrections to the mapping", () => {
  const sheet: Sheet = { headers: [...sheets.orders.headers, "purchase_date"], rows: sheets.orders.rows.slice(0, 3000).map((o) => [...o, o[3]]) };
  const tables = [table("orders.csv", sheet)];
  const detection = detectSchema(tables);
  const m = detection.mappings[0];
  const col = (name: string) => tables[0].headers.indexOf(name);

  it("moves a field to the chosen column and releases the previous one", () => {
    const next = assignField(m, col("purchase_date"), "order_date");
    expect(next.columns[col("purchase_date")]).toMatchObject({ field: "order_date", confirmed: true });
    expect(next.columns[col("order_date")].field).toBeNull();
    expect(next.columns.some(needsConfirmation)).toBe(false);
  });
  it("lets a column be ignored and a pending mapping be confirmed", () => {
    expect(assignField(m, col("country"), null).columns[col("country")].field).toBeNull();
    expect(needsConfirmation(confirmColumn(m, col("order_date")).columns[col("order_date")])).toBe(false);
  });
  it("re-reads a file as a different table, or as nothing", () => {
    expect(remapAs(detection.profiles[m.source], m.source, null).columns.every((c) => c.field === null)).toBe(true);
    expect(remapAs(detection.profiles[m.source], m.source, "delivery").columns.find((c) => c.field === "order_id")).toBeDefined();
  });
});
