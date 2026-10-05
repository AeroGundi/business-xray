import type { Availability } from "@/types/domain";
import { canSimulate } from "@/lib/simulation/model";
import type { Extracted, Relationship } from "./extract";
import { MIN_WEEKS, type Normalised } from "./normalize";
import { TABLES } from "./schema";

/**
 * DATA READINESS — how well the uploaded data can support the X-Ray.
 *
 *   readiness = Σ wᵢ · dimensionᵢ      (weights in WEIGHTS, summing to 1)
 *
 *   Data coverage        share of the canonical template fields that are present,
 *                        weighted required 3 · core 2 · extra 1
 *   Data quality         mean of completeness (filled cells), validity (cells that
 *                        could be read as their type) and usable rows (rows not
 *                        set aside as duplicate, impossible or incomplete)
 *   Relationships        mean share of records whose link to another file resolves;
 *                        not scored when only one file was provided
 *   Temporal coverage    weeks of history / 104, capped at 1 (two years let
 *                        seasonality be seen twice)
 *   Analytical coverage  mean over the capability matrix: available 1, limited ½,
 *                        unavailable 0
 *
 * A dimension that does not apply is left out and the remaining weights are
 * rescaled. Every input is a count taken from the data; nothing is judged.
 */

export const WEIGHTS = { coverage: 0.25, quality: 0.25, relationships: 0.15, temporal: 0.15, analytical: 0.2 };
export const FULL_HISTORY_WEEKS = 104;
const FIELD_WEIGHT = { required: 3, core: 2, extra: 1 };

export type Status = "available" | "limited" | "unavailable";

export interface Capability {
  id: string;
  label: string;
  status: Status;
  /** Why it is limited or unavailable, in terms of the data. */
  reason?: string;
}

export interface Dimension {
  id: keyof typeof WEIGHTS;
  label: string;
  /** 0..1, or null when the dimension does not apply. */
  score: number | null;
  detail: string;
}

export interface Readiness {
  score: number;
  dimensions: Dimension[];
  /** Business entities and whether the data covers them. */
  entities: { id: string; label: string; status: Status }[];
  capabilities: Capability[];
}

export function capabilitiesOf(n: Normalised): Capability[] {
  const a = n.availability as Availability;
  const data = n.data!;
  const m = (id: string) => a.metrics.includes(id);
  const d = (id: string) => a.dims.orders.includes(id);
  const cap = (id: string, label: string, ok: boolean, missing: string, limited?: string | false): Capability =>
    !ok ? { id, label, status: "unavailable", reason: missing } : limited ? { id, label, status: "limited", reason: limited } : { id, label, status: "available" };
  const drivers = ["delivery", "discount", "returns", "repurchase", "shipping"].filter(m).length;
  const dims = a.dims.orders.length;

  return [
    cap("revenue", "Revenue trends", true, ""),
    cap("anomaly", "Anomaly detection", data.weeks >= MIN_WEEKS, "Not enough history.", data.weeks < 52 && "Under a year of history: seasonal effects cannot be told apart from changes."),
    cap("contribution", "Contribution analysis", dims > 0, "No dimension to break the business down by.", dims < 3 && "Few dimensions available to locate a change."),
    cap("geography", "Geographic analysis", d("country"), "No country found in the data."),
    cap("products", "Product performance", d("product"), "Products are not identified in the orders.", !d("category") && "No product categories."),
    cap("segments", "Customer segmentation", d("segment"), "No customer segment found."),
    cap("behaviour", "Customer behaviour and retention", m("repurchase"), "Orders are not linked to customers.", !n.facts.hasSignupDates && "No signup dates: early weeks overstate new customers."),
    cap("channels", "Acquisition channels", d("channel"), "No acquisition channel found."),
    cap("discounts", "Discount analysis", m("discount"), "No discount information."),
    cap("profit", "Profitability", m("margin"), "Missing product cost data.", n.facts.costImputed > 0 ? "Some products have no cost; an average was used." : !m("shipping") ? "Shipping cost not included." : false),
    cap("delivery", "Delivery performance", m("delivery"), "Delivery dataset not provided.", n.facts.promisedFromData && "No promised date: measured against typical delivery time."),
    cap("returns", "Returns analysis", m("returns"), "Returns dataset not provided."),
    cap("marketing", "Marketing efficiency", m("cac"), m("spend") ? "Marketing channels do not match customer acquisition channels." : "Marketing dataset not provided."),
    cap("rootcause", "Root-cause analysis", dims > 0 && drivers > 0, "No operational data to test as a cause.", drivers < 3 && "Few operational measures to test as possible causes."),
    cap("ask", "Ask the business", true, ""),
    cap("whatif", "Scenario simulation", canSimulate(data), "Needs cost, marketing, delivery and returns data."),
  ];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function computeReadiness(x: Extracted, relationships: Relationship[], n: Normalised): Readiness | null {
  if (!n.data || !n.availability) return null;
  const capabilities = capabilitiesOf(n);

  let got = 0;
  let all = 0;
  for (const table of TABLES) for (const field of table.fields) {
    if (!field.template) continue;
    all += FIELD_WEIGHT[field.level];
    if (x.headers[table.id]?.[field.id]) got += FIELD_WEIGHT[field.level];
  }
  const coverage = got / all;

  const cells = x.quality.reduce((s, q) => s + q.rows, 0);
  const missing = x.quality.reduce((s, q) => s + q.missing, 0);
  const invalid = x.quality.reduce((s, q) => s + q.invalid, 0);
  const read = Object.values(x.rowsRead).reduce((s, r) => s + r, 0);
  const rejected = x.rejections.reduce((s, r) => s + r.rows.length, 0);
  const completeness = cells ? 1 - missing / cells : 0;
  const validity = cells - missing > 0 ? 1 - invalid / (cells - missing) : 0;
  const usable = read ? 1 - rejected / read : 0;
  const quality = mean([completeness, validity, usable]);

  const links = relationships.filter((r) => r.total > 0);
  const integrity = links.length ? mean(links.map((r) => r.rate)) : null;
  const temporal = Math.min(1, n.data.weeks / FULL_HISTORY_WEEKS);
  const analytical = mean(capabilities.map((c) => (c.status === "available" ? 1 : c.status === "limited" ? 0.5 : 0)));

  const pct = (v: number) => (v < 1 && v >= 0.995 ? `${(Math.floor(v * 1000) / 10).toFixed(1)}%` : `${Math.round(v * 100)}%`);
  const dimensions: Dimension[] = [
    { id: "coverage", label: "Data coverage", score: coverage, detail: "Share of the template's fields found in your files, weighted by importance." },
    { id: "quality", label: "Data quality", score: quality, detail: `${pct(completeness)} of cells filled · ${pct(validity)} readable · ${pct(usable)} of rows usable.` },
    { id: "relationships", label: "Relationships", score: integrity, detail: integrity === null ? "Only one file was provided, so there are no links to check." : `${links.length} ${links.length === 1 ? "link" : "links"} between files; share of records that connect.` },
    { id: "temporal", label: "Temporal coverage", score: temporal, detail: `${n.data.weeks} weeks of history; ${FULL_HISTORY_WEEKS} weeks score 100%.` },
    { id: "analytical", label: "Analytical coverage", score: analytical, detail: `${capabilities.filter((c) => c.status === "available").length} of ${capabilities.length} analyses fully available.` },
  ];
  const scored = dimensions.filter((dim) => dim.score !== null);
  const weight = scored.reduce((s, dim) => s + WEIGHTS[dim.id], 0);
  const score = scored.reduce((s, dim) => s + WEIGHTS[dim.id] * dim.score!, 0) / weight;

  const status = (id: string): Status => capabilities.find((c) => c.id === id)!.status;
  const entities: Readiness["entities"] = [
    { id: "customers", label: "Customers", status: status("behaviour") === "unavailable" ? "unavailable" : status("segments") === "available" && status("behaviour") === "available" ? "available" : "limited" },
    { id: "orders", label: "Orders", status: "available" },
    { id: "products", label: "Products", status: status("products") },
    { id: "revenue", label: "Revenue", status: "available" },
    { id: "geography", label: "Geography", status: status("geography") },
    { id: "delivery", label: "Delivery", status: status("delivery") },
    { id: "marketing", label: "Marketing", status: status("marketing") },
    { id: "profit", label: "Profit", status: status("profit") },
  ];
  return { score, dimensions, entities, capabilities };
}
