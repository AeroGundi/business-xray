import type { SourceMapping } from "./detect";
import { type Extracted, type Relationship, missingTables } from "./extract";
import { MIN_COST_COVERAGE, MIN_DELIVERY_COVERAGE, MIN_WEEKS, type Normalised } from "./normalize";
import type { RawTable } from "./parse";
import { TABLE, type TableId, fieldOf } from "./schema";

/**
 * VALIDATION, step 2 — turning what extraction and normalisation found into
 * issues a non-technical person can act on. Every issue says what it means,
 * how many records it touches, what the X-Ray did about it, and the way forward.
 */

export type IssueLevel = "blocker" | "warning" | "note";
export type IssueGroup = "file" | "columns" | "data" | "relationships" | "business";

export interface Issue {
  id: string;
  level: IssueLevel;
  group: IssueGroup;
  table?: TableId;
  title: string;
  /** What it means and what was done about it. */
  detail: string;
  affected?: number;
  /** What `affected` counts, e.g. "orders". */
  unit?: string;
  /** The way forward. */
  fix: string;
  /** Rows of the user's own file that show the problem. */
  sample?: { headers: string[]; rows: string[][] };
}

const count = (n: number) => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function sampleOf(source: RawTable | undefined, rows: number[], limit = 5): Issue["sample"] {
  if (!source || rows.length === 0) return undefined;
  return { headers: source.headers, rows: rows.slice(0, limit).map((r) => source.rows[r]) };
}

const BLOCKER_TEXT: Record<string, Omit<Issue, "id" | "level" | "group">> = {
  orders: {
    title: "We could not find an orders file.",
    detail: "Orders are the centre of the X-Ray: every analysis starts from what was sold and when.",
    fix: "Add a file with one row per order line, or tell us which of your files holds the orders.",
  },
  order_date: {
    title: "We could not identify the fields required to analyze orders.",
    detail: "No column in your orders file was recognised as the order date.",
    fix: "Open the mapping and choose the column that holds the date of each order.",
  },
  price: {
    title: "We could not identify the fields required to analyze orders.",
    detail: "No column in your orders file was recognised as a price or a line total, so revenue cannot be measured.",
    fix: "Open the mapping and choose the column that holds the unit price or the amount charged.",
  },
  "no-rows": {
    title: "This file contains no usable records.",
    detail: "After setting aside rows without a valid date or price, no orders were left.",
    fix: "Check the date and price columns in the mapping, or review the file.",
  },
};

export function validate(tables: RawTable[], mappings: SourceMapping[], x: Extracted, relationships: Relationship[], n: Normalised): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);
  const orderUnit = TABLE.orders.rows;

  // --- Files -----------------------------------------------------------------------------------
  for (const m of mappings) {
    const source = tables.find((t) => t.id === m.source)!;
    for (const note of source.notes) add({ id: `note-${source.id}`, level: "note", group: "columns", title: `${source.name}: ${note}`, detail: "Each repeated column is treated as a separate column.", fix: "Rename the columns in your file if the wrong one was mapped." });
    if (!m.table) {
      add({
        id: `unknown-${source.id}`, level: "warning", group: "file", title: `We could not tell what ${source.name} contains.`,
        detail: "Its columns did not match any of the tables the X-Ray understands, so it is not used.",
        fix: "Open the mapping and tell us what this file holds, or continue without it.",
      });
    }
  }

  // --- Blockers --------------------------------------------------------------------------------
  for (const b of n.blockers) {
    if (b === "history") {
      add({
        id: "history", level: "blocker", group: "business", title: "Your data does not cover enough time yet.",
        detail: `The X-Ray compares the last 10 weeks with the 10 before, and judges the difference against how the business moved earlier. That needs ${MIN_WEEKS} weeks of orders; your file covers ${n.facts.weeks}.`,
        fix: "Export a longer period of orders and add the file again, or explore the demo business in the meantime.",
      });
    } else add({ id: `blocker-${b}`, level: "blocker", group: "business", table: "orders", ...BLOCKER_TEXT[b] });
  }

  // --- Columns: fields the full X-Ray needs but the mapping lacks ---------------------------------
  const oh = x.headers.orders ?? {};
  if (x.records.orders) {
    if (!oh.customer_id) {
      add({
        id: "no-customer", level: "warning", group: "columns", table: "orders", title: "We could not find who placed each order.",
        detail: "Without a customer identifier the X-Ray cannot tell new customers from returning ones. Retention, acquisition and segment analysis are left out.",
        fix: "Open the mapping and choose the customer column, or continue without customer analysis.",
      });
    }
    if (!oh.product_id && !oh.product_name) {
      add({
        id: "no-product", level: "warning", group: "columns", table: "orders", title: "We could not find what was bought in each order.",
        detail: "Product and category analysis are left out.",
        fix: "Open the mapping and choose the product column, or continue without product analysis.",
      });
    }
    if (!oh.quantity) {
      add({ id: "no-quantity", level: "note", group: "columns", table: "orders", title: "No quantity column was found.", detail: "Every order line is counted as one unit.", fix: "Map the quantity column if your file has one." });
    }
  }

  // --- Data: rows set aside -----------------------------------------------------------------------
  for (const r of x.rejections) {
    const def = TABLE[r.table];
    const field = r.field ? fieldOf(r.table, r.field) : undefined;
    const header = r.field ? (x.headers[r.table]?.[r.field] ?? field?.label ?? r.field) : "";
    const n = r.rows.length;
    const rows = `${count(n)} ${plural(n, def.row, def.rows)}`;
    const base = { table: r.table, affected: n, unit: plural(n, def.row, def.rows), sample: sampleOf(x.sources[r.table], r.rows), group: "data" as const };
    const share = n / (x.rowsRead[r.table] ?? n);
    const level: IssueLevel = share > 0.05 ? "warning" : "note";
    if (r.reason === "duplicate" && !r.field) {
      add({ ...base, id: `dup-${r.table}`, level, title: `${rows} appear twice in your ${def.label.toLowerCase()} file.`, detail: "Rows that are identical in every column were counted once.", fix: "Nothing to do unless these were genuinely separate records." });
    } else if (r.reason === "duplicate") {
      add({ ...base, id: `dupkey-${r.table}`, level, title: `${rows} repeat an identifier that was already listed.`, detail: `Each ${def.row} should appear once. The first row was kept and the repeats were set aside.`, fix: `Check the ${def.label.toLowerCase()} file for repeated entries.` });
    } else if (r.reason === "missing") {
      add({ ...base, id: `missing-${r.table}-${r.field}`, level, title: `${rows} ${n === 1 ? "has" : "have"} no ${field?.label.toLowerCase()}.`, detail: `“${header}” is empty in these rows, so they cannot be placed in the analysis and were set aside.`, fix: "Fill in the missing values in your file, or continue without these rows." });
    } else if (r.reason === "invalid") {
      add({ ...base, id: `invalid-${r.table}-${r.field}`, level, title: `In ${rows}, the ${field?.label.toLowerCase()} could not be read.`, detail: `The value in “${header}” is not a ${field?.type === "date" ? "date" : "number"} we recognise. These rows were set aside.`, fix: "Check the format of this column in your file, or pick a different column in the mapping." });
    } else {
      const why = field?.type === "date" ? "a date in the future or before 1990" : r.field === "quantity" ? "a quantity of zero or less" : "a negative amount";
      add({ ...base, id: `impossible-${r.table}-${r.field}`, level, title: `${rows} ${n === 1 ? "has" : "have"} ${why}.`, detail: `These values in “${header}” cannot be real ${def.rows} and were set aside. Negative lines are often credit notes; the X-Ray reads returns from the returns file instead.`, fix: "Review these rows in your file, or continue without them." });
    }
  }

  // --- Data: values inside otherwise usable rows ---------------------------------------------------
  for (const q of x.quality) {
    const field = fieldOf(q.table, q.field);
    if (!field || field.level === "required") continue;
    if (q.invalid > 0) {
      add({
        id: `unread-${q.table}-${q.field}`, level: q.invalid / q.rows > 0.05 ? "warning" : "note", group: "data", table: q.table, affected: q.invalid, unit: plural(q.invalid, "value"),
        title: `${count(q.invalid)} ${plural(q.invalid, "value")} in “${q.header}” could not be read as a ${field.type === "date" ? "date" : "number"}.`,
        detail: `For example: ${q.invalidExamples.map((e) => `“${e}”`).join(", ")}. These cells are treated as empty.`,
        fix: "Check that the column uses one format throughout.",
      });
    }
    if (q.missing / q.rows > 0.2 && field.level === "core") {
      add({
        id: `sparse-${q.table}-${q.field}`, level: "warning", group: "data", table: q.table, affected: q.missing, unit: plural(q.missing, TABLE[q.table].row, TABLE[q.table].rows),
        title: `“${q.header}” is empty in ${Math.round((100 * q.missing) / q.rows)}% of ${TABLE[q.table].label.toLowerCase()}.`,
        detail: `Analysis by ${field.label.toLowerCase()} will show these as “Unknown”.`,
        fix: "Fill in the column if the information exists, or continue: results by this field are less reliable.",
      });
    }
  }
  for (const d of x.ambiguousDates) {
    add({
      id: `dateorder-${d.table}-${d.header}`, level: "note", group: "data", table: d.table, title: `Dates in “${d.header}” were read as day / month / year.`,
      detail: "No date in the column has a day above 12, so the order of day and month cannot be confirmed from the values.",
      fix: "If your dates are month-first, export them as year-month-day and add the file again.",
    });
  }
  const f = n.facts;
  if (f.discountOutOfRange > 0) add({ id: "discount-range", level: "note", group: "data", table: "orders", affected: f.discountOutOfRange, unit: orderUnit, title: `${count(f.discountOutOfRange)} discounts are negative or 100% and above.`, detail: "These lines are treated as having no discount.", fix: "Check the discount column in your file." });
  if (f.discountMode) add({ id: "discount-mode", level: "note", group: "data", table: "orders", title: `Discounts were read as ${f.discountMode === "fraction" ? "a fraction of the price (0.10 = 10%)" : f.discountMode === "percent" ? "percentages (10 = 10%)" : "amounts of money"}.`, detail: "Decided from the column name and the range of its values.", fix: "If this is wrong, convert the column to a fraction between 0 and 1 and add the file again." });
  if (f.deliveredBeforeOrdered > 0) add({ id: "delivery-order", level: "note", group: "data", table: "delivery", affected: f.deliveredBeforeOrdered, unit: orderUnit, title: `${count(f.deliveredBeforeOrdered)} orders were delivered before they were placed.`, detail: "Their delivery dates are ignored.", fix: "Check the order and delivery dates of these orders." });
  if (f.mergedSpellings > 0) add({ id: "spellings", level: "note", group: "data", title: "Some names are written in more than one way.", detail: "Values that differ only in capitals, accents or language (for example “Spain”, “ES” and “España”) were merged.", fix: "Nothing to do." });
  if (f.leadingRowsDropped > 0) add({ id: "leading", level: "note", group: "data", table: "orders", affected: f.leadingRowsDropped, unit: orderUnit, title: "The first few days of your data were left out.", detail: "The X-Ray works in complete weeks counted back from your last order; the incomplete first week is not used.", fix: "Nothing to do." });
  if (f.linesPerOrder > 1.02) add({ id: "lines", level: "note", group: "data", table: "orders", title: "Orders with several products are analysed line by line.", detail: `Your orders hold ${f.linesPerOrder.toFixed(2)} product lines on average. Counts labelled “orders” in the X-Ray refer to these lines.`, fix: "Nothing to do." });
  if (x.records.customers && x.headers.orders?.customer_id && !f.hasSignupDates) add({ id: "no-signup", level: "note", group: "data", table: "customers", title: "No signup date was found for customers.", detail: "A customer's first order in the file is taken as the moment they were acquired, which overstates new customers in the first weeks.", fix: "Map the signup date column if your customer file has one." });

  // --- Relationships ------------------------------------------------------------------------------
  for (const r of relationships) {
    const broken = r.total - r.matched;
    if (broken === 0) continue;
    const child = TABLE[r.child];
    const parent = TABLE[r.parent];
    const level: IssueLevel = r.rate < 0.9 ? "warning" : "note";
    const base = { level, group: "relationships" as const, table: r.child, affected: broken, unit: plural(broken, child.row, child.rows), sample: sampleOf(x.sources[r.child], r.orphans) };
    if (r.child === "orders") {
      const what = r.parent === "customers" ? "customers" : "products";
      add({
        ...base, id: `orphan-${r.parent}`, title: `Some orders reference ${what} that are missing from the uploaded data.`,
        detail: `${count(broken)} ${plural(broken, child.row, child.rows)} point at a ${parent.row} that is not in your ${parent.label.toLowerCase()} file. The orders are kept; their ${r.parent === "customers" ? "segment and channel" : "category and cost"} are unknown.`,
        fix: `Export the complete ${parent.label.toLowerCase()} list, or continue: these orders appear as “Unknown” in breakdowns.`,
      });
    } else if (r.child === "marketing") {
      add({
        ...base, id: "orphan-channel", title: "Some marketing spend is on channels no customer is attributed to.",
        detail: "Channel names in the marketing file do not match the acquisition channels in the customer file, so the cost of acquiring a customer cannot be worked out for them.",
        fix: "Use the same channel names in both files.",
      });
    } else {
      add({
        ...base, id: `orphan-${r.child}`, title: `Some ${child.label.toLowerCase()} records reference orders that are not in your orders file.`,
        detail: `${count(broken)} ${plural(broken, child.row, child.rows)} could not be matched to an order and are not used.`,
        fix: "Check that both files cover the same period and use the same order identifiers.",
      });
    }
  }

  // --- Business: what is missing and what it costs the analysis -------------------------------------
  if (n.data) {
    const has = (m: string) => n.availability!.metrics.includes(m);
    const gone = missingTables(x);
    const hasCostColumn = !!x.headers.products?.cost || !!oh.unit_cost;
    if (hasCostColumn && f.costCoverage < MIN_COST_COVERAGE) {
      add({ id: "cost-coverage", level: "warning", group: "business", title: "Too few products have a cost to measure profit.", detail: `Only ${Math.round(f.costCoverage * 100)}% of revenue comes from products with a known cost; ${Math.round(MIN_COST_COVERAGE * 100)}% is needed. Profitability is left out.`, fix: "Add the missing costs to your product file." });
    } else if (f.costImputed > 0) {
      add({ id: "cost-imputed", level: "warning", group: "business", affected: f.costImputed, unit: orderUnit, title: `${count(f.costImputed)} order lines have no product cost.`, detail: "They were given the average cost-to-price ratio of your other products, so profit figures are approximate.", fix: "Add the missing costs to your product file for an exact figure." });
    }
    if ((x.records.delivery || oh.delivery_date) && f.deliveryCoverage < MIN_DELIVERY_COVERAGE) {
      add({ id: "delivery-coverage", level: "warning", group: "business", title: "Too few orders have a delivery date.", detail: `Only ${Math.round(f.deliveryCoverage * 100)}% of orders could be matched to a delivery. Delivery performance is left out.`, fix: "Check that the delivery file covers the same orders." });
    } else if (has("delivery") && f.promisedFromData) {
      add({ id: "promise", level: "note", group: "business", title: "No promised delivery date was found.", detail: "An order counts as on time when it arrives within one day of the usual delivery time for its country.", fix: "Add a promised date column to the delivery file to measure against your own promise." });
    }
    if (has("margin") && !has("shipping")) add({ id: "no-shipping", level: "note", group: "business", title: "Shipping costs are not in your data.", detail: "Profit is measured after product cost and returns, but before shipping.", fix: "Add a shipping cost column to the orders file to include it." });
    if (has("margin") && has("returns")) add({ id: "return-loss", level: "note", group: "business", title: "The cost of a return is estimated.", detail: "A returned order is assumed to lose its margin plus two-way shipping and a quarter of the product cost.", fix: "Nothing to do; keep this in mind when reading profit figures." });
    if (gone.length > 0) {
      const lost: Record<TableId, string> = {
        orders: "", customers: "customer segments and acquisition channels", products: "product names, categories and profitability",
        delivery: "delivery performance and logistics root causes", marketing: "marketing efficiency and acquisition cost", returns: "return rates",
      };
      for (const t of gone) {
        // A flat orders export can carry the same information in its own columns.
        const covered = t === "customers" ? oh.segment || oh.channel : t === "products" ? oh.category || oh.unit_cost : t === "delivery" ? oh.delivery_date : false;
        if (t === "orders" || covered) continue;
        add({
          id: `absent-${t}`, level: "note", group: "business", table: t, title: `${TABLE[t].label} data not found.`,
          detail: `Your X-Ray can still continue. It will not cover ${lost[t]}.`,
          fix: `Add a ${TABLE[t].label.toLowerCase()} file to unlock this, or continue without it.`,
        });
      }
    }
    const dropped = x.rejections.filter((r) => r.table === "orders").reduce((s, r) => s + r.rows.length, 0);
    if (dropped / (x.rowsRead.orders ?? 1) > 0.1) {
      add({ id: "quality", level: "warning", group: "business", affected: dropped, unit: orderUnit, title: "Your data can be analyzed, but some results may be less reliable.", detail: `${Math.round((100 * dropped) / (x.rowsRead.orders ?? 1))}% of order rows had to be set aside.`, fix: "Review the issues above and add a corrected file for a more dependable X-Ray." });
    }
  }

  const rank = { blocker: 0, warning: 1, note: 2 };
  return issues.sort((a, b) => rank[a.level] - rank[b.level]);
}
