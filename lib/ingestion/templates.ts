import { strToU8, zipSync } from "fflate";
import type { Dataset } from "@/types/domain";
import { TABLE, TABLES, type TableId } from "./schema";

/**
 * Downloadable templates. Each is a CSV with the canonical column names and
 * a few coherent example rows (the same order, customer and product appear
 * across files), so the expected structure is visible without documentation.
 */

export interface Sheet {
  headers: string[];
  rows: (string | number)[][];
}

const EXAMPLES: Record<TableId, (string | number)[][]> = {
  orders: [
    [10001, "C1023", "P204", "2025-01-03", 2, 79.9, 0.1, "Spain"],
    [10002, "C1187", "P118", "2025-01-03", 1, 249.0, 0, "Germany"],
    [10002, "C1187", "P204", "2025-01-03", 1, 79.9, 0, "Germany"],
    [10003, "C1023", "P331", "2025-01-17", 3, 39.0, 0.15, "Spain"],
  ],
  customers: [
    ["C1023", "2024-11-20", "Consumer", "Spain", "Paid Social"],
    ["C1187", "2025-01-03", "Business", "Germany", "Organic"],
  ],
  products: [
    ["P118", "Pulse Watch", "Wearables", 138.0],
    ["P204", "Lumen Desk Lamp", "Home Office", 31.0],
    ["P331", "Volt Charger", "Accessories", 12.0],
  ],
  delivery: [
    [10001, "2025-01-04", "2025-01-07"],
    [10002, "2025-01-04", "2025-01-06"],
    [10003, "2025-01-18", "2025-01-24"],
  ],
  marketing: [
    ["2025-01-06", "Paid Social", 3400, "Winter sale"],
    ["2025-01-06", "Paid Search", 4200, "Brand terms"],
    ["2025-01-13", "Paid Social", 3650, "Winter sale"],
  ],
  returns: [[10003, "2025-01-29", "Arrived late"]],
};

export const templateSheet = (table: TableId): Sheet => ({
  headers: TABLE[table].fields.filter((f) => f.template).map((f) => f.id),
  rows: EXAMPLES[table],
});

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (sheet: Sheet): string => [sheet.headers, ...sheet.rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";

export const templateFileName = (table: TableId): string => `${table}_template.csv`;

const README = `BUSINESS X-RAY — e-commerce data template

Fill in the files you have and upload them together. Keep the first row (the column names).
Only orders is essential; every other file unlocks more of the analysis.

${TABLES.map((t) => `${t.label.toUpperCase()} (${t.importance}) — ${t.purpose}\n${t.fields.filter((f) => f.template).map((f) => `  ${f.id.padEnd(20)} ${f.meaning}`).join("\n")}`).join("\n\n")}

Dates: year-month-day (2025-01-03) is safest. Discounts: a fraction of the price (0.10 = 10%).
Your own column names also work: the X-Ray recognises them and asks you to confirm when unsure.
`;

/** The complete e-commerce template as a ZIP of CSV files plus a short README. */
export function templateZip(): Uint8Array {
  const files: Record<string, Uint8Array> = { "README.txt": strToU8(README) };
  for (const t of TABLES) files[templateFileName(t.id)] = strToU8(toCsv(templateSheet(t.id)));
  return zipSync(files);
}

const DAY = 86400000;

/**
 * The demo business written out in the template's format: a complete, filled
 * example of what the X-Ray expects, and the fixture used to test that
 * ingestion reproduces the engine's results (tests/ingestion.test.ts).
 */
export function datasetToSheets(data: Dataset): Record<TableId, Sheet> {
  const start = Date.parse(data.startDate);
  const day = (week: number, offset = 0) => new Date(start + (week * 7 + offset) * DAY).toISOString().slice(0, 10);
  const productId = new Map(data.products.map((p) => [p.name, p.id]));
  const countryName = new Map(data.countries.map((c) => [c.code, c.name]));
  const buyers = new Set(data.orders.map((o) => o.customerId));
  const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

  const orders: Sheet = { headers: [...templateSheet("orders").headers, "shipping_cost"], rows: [] };
  const delivery: Sheet = { headers: [...templateSheet("delivery").headers, "promised_date"], rows: [] };
  const returns: Sheet = { headers: templateSheet("returns").headers, rows: [] };
  for (const o of data.orders) {
    const offset = o.id % 7;
    const id = 100000 + o.id;
    orders.rows.push([id, `C${o.customerId}`, productId.get(o.product) ?? o.product, day(o.week, offset), o.quantity, round(o.listAmount / o.quantity), round(o.discountAmount / o.listAmount, 4), o.country, round(o.shipping)]);
    const arrived = offset + Math.round(o.deliveryDays);
    delivery.rows.push([id, day(o.week, offset + 1), day(o.week, arrived), day(o.week, offset + Math.round(o.promisedDays))]);
    if (o.returned) returns.rows.push([id, day(o.week, arrived + 7), "Not specified"]);
  }
  return {
    orders,
    customers: {
      headers: templateSheet("customers").headers,
      rows: data.customers.filter((c) => buyers.has(c.id)).map((c) => [`C${c.id}`, day(c.acquiredWeek), c.segment, countryName.get(c.country) ?? c.country, c.channel]),
    },
    products: { headers: templateSheet("products").headers, rows: data.products.map((p) => [p.id, p.name, p.category, p.unitCost]) },
    delivery,
    marketing: { headers: [...templateSheet("marketing").headers, "country"], rows: data.marketing.map((m) => [day(m.week), m.channel, m.spend, "Always on", m.country]) },
    returns,
  };
}

/** The demo business as a ZIP of template-format CSV files. */
export function exampleZip(data: Dataset): Uint8Array {
  const sheets = datasetToSheets(data);
  return zipSync(Object.fromEntries(TABLES.map((t) => [`${t.id}.csv`, strToU8(toCsv(sheets[t.id]))])), { level: 6 });
}
