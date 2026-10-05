/** Writes the synthetic dataset and the engine's output to /data for inspection. Run: npm run export */
import { mkdirSync, writeFileSync } from "node:fs";
import { generateDataset } from "../lib/data/generate";
import { computeHealth } from "../lib/analytics/health";
import { detectFindings } from "../lib/insights/findings";

const data = generateDataset();
const csv = (rows: object[]) => [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).join(","))].join("\n");

mkdirSync("data/raw", { recursive: true });
mkdirSync("data/processed", { recursive: true });
writeFileSync("data/raw/orders.csv", csv(data.orders));
writeFileSync("data/raw/customers.csv", csv(data.customers));
writeFileSync("data/raw/marketing.csv", csv(data.marketing));
writeFileSync("data/raw/products.csv", csv(data.products));
writeFileSync("data/raw/countries.csv", csv(data.countries));

const findings = detectFindings(data);
writeFileSync("data/processed/findings.json", JSON.stringify({ seed: data.seed, health: computeHealth(data, findings), findings }, null, 2));
console.log(`exported ${data.orders.length} orders, ${data.customers.length} customers, ${findings.length} findings`);
