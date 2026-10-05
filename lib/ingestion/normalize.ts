import type { Availability, CategoryId, ChannelId, Customer, Dataset, MarketingRow, OrderRow, SegmentId } from "@/types/domain";
import { markRepurchases } from "@/lib/data/generate";
import { WINDOW_WEEKS } from "@/lib/analytics/metrics";
import { median } from "@/lib/analytics/stats";
import { joinKey } from "./detect";
import { type Extracted, type Rec, num, str } from "./extract";
import { DAY, isoDay, keyOf, normalise, toCountry } from "./values";

/**
 * NORMALISATION — canonical records → the Dataset the analytics engine reads.
 *
 * The engine was built for the demo business; rather than teaching it about
 * user schemas, uploaded data is reshaped into exactly the same structure
 * (the denormalised order fact table plus weekly marketing rows). What the
 * data cannot support is recorded in `Dataset.available`, and the engine
 * leaves those analyses out instead of computing them from placeholders.
 *
 * Conventions (all documented in docs/METHODOLOGY.md §12):
 *  - Weeks are 7-day blocks ending on the last order date; a leading partial week is dropped.
 *  - revenue = quantity × unit price − discount (or the line total when no unit price exists).
 *  - profit  = revenue − cost − shipping, or −(2 × shipping + 25% of cost) for a returned order,
 *              the same convention as the demo business.
 *  - Without a promised date, an order is "on time" when it arrives within one day of the
 *    typical (median) delivery time of its country.
 */

/** Shortest history the anomaly detector can work with: two 10-week windows plus 12 earlier placements, and the first usable one. */
export const MIN_WEEKS = 2 * WINDOW_WEEKS + 21;
/** Share of revenue that must have a known cost for profit to be reported. */
export const MIN_COST_COVERAGE = 0.8;
/** Share of orders that must have a delivery date for delivery metrics to be reported. */
export const MIN_DELIVERY_COVERAGE = 0.3;
const UNKNOWN = "Unknown";

export type DiscountMode = "fraction" | "percent" | "amount";

export interface Summary {
  customers: number;
  orders: number;
  orderLines: number;
  products: number;
  countries: number;
  weeks: number;
  months: number;
  from: string;
  to: string;
  revenue: number;
}

export interface Normalised {
  /** Null when the data cannot be analysed at all; `blockers` says why. */
  data: Dataset | null;
  summary: Summary | null;
  availability: Availability | null;
  facts: {
    weeks: number;
    discountMode: DiscountMode | null;
    costCoverage: number;
    costImputed: number;
    deliveryCoverage: number;
    promisedFromData: boolean;
    returnsMatched: number;
    leadingRowsDropped: number;
    /** Order lines per order; above 1 when orders hold several products. */
    linesPerOrder: number;
    mergedSpellings: number;
    deliveredBeforeOrdered: number;
    discountOutOfRange: number;
    unattributedSpend: number;
    hasSignupDates: boolean;
  };
  blockers: string[];
}

/** Maps spellings that differ only in case, accents or punctuation onto the first form seen. */
class Canon {
  private map = new Map<string, string>();
  private spellings = new Map<string, Set<string>>();
  constructor(private fn: (s: string) => string = (s) => s) {}
  of(raw: string | null): string | null {
    if (raw === null || raw === "") return null;
    const label = this.fn(raw);
    const key = normalise(label);
    const seen = this.spellings.get(key) ?? this.spellings.set(key, new Set()).get(key)!;
    if (seen.size < 8) seen.add(raw);
    const known = this.map.get(key);
    if (known === undefined) this.map.set(key, label);
    return known ?? label;
  }
  /** Values that were written in more than one way. */
  get merged(): number {
    let n = 0;
    for (const s of this.spellings.values()) if (s.size > 1) n++;
    return n;
  }
  get size(): number {
    return this.map.size;
  }
}

/** How a discount column should be read, decided from its header and values. */
export function detectDiscountMode(header: string, values: number[]): DiscountMode {
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 0) return "fraction";
  const max = Math.max(...nonZero);
  if (max <= 1) return "fraction";
  if (/%|pct|percent|porc|rate/i.test(header)) return "percent";
  const round = nonZero.filter((v) => Number.isInteger(v * 2)).length / nonZero.length;
  return max <= 100 && round >= 0.9 ? "percent" : "amount";
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function normaliseDataset(x: Extracted, company = "Your business", currency = "€"): Normalised {
  const facts: Normalised["facts"] = {
    weeks: 0, discountMode: null, costCoverage: 0, costImputed: 0, deliveryCoverage: 0, promisedFromData: false, returnsMatched: 0,
    leadingRowsDropped: 0, linesPerOrder: 1, mergedSpellings: 0, deliveredBeforeOrdered: 0, discountOutOfRange: 0, unattributedSpend: 0, hasSignupDates: false,
  };
  const fail = (...blockers: string[]): Normalised => ({ data: null, summary: null, availability: null, facts, blockers });

  const orderRecs = x.records.orders;
  const oh = x.headers.orders ?? {};
  if (!orderRecs) return fail("orders");
  if (!oh.order_date) return fail("order_date");
  if (!oh.unit_price && !oh.amount) return fail("price");
  if (orderRecs.length === 0) return fail("no-rows");

  // --- Time axis -----------------------------------------------------------------------------
  let first = Infinity;
  let last = -Infinity;
  for (const r of orderRecs) {
    const t = r.order_date as number;
    if (t < first) first = t;
    if (t > last) last = t;
  }
  const weeks = Math.floor(((last - first) / DAY + 1) / 7);
  facts.weeks = weeks;
  if (weeks < MIN_WEEKS) return fail("history");
  const weekOf = (t: number): number => weeks - 1 - Math.floor((last - t) / (7 * DAY));
  const startDate = isoDay(last - (weeks * 7 - 1) * DAY);

  // --- Reference tables ----------------------------------------------------------------------
  const idKey = joinKey("customer_id");
  const customerRecs = new Map<string, Rec>();
  for (const r of x.records.customers ?? []) customerRecs.set(idKey(String(r.customer_id)), r);
  const productRecs = new Map<string, Rec>();
  for (const r of x.records.products ?? []) productRecs.set(idKey(String(r.product_id)), r);
  const deliveries = new Map<string, Rec>();
  for (const r of x.records.delivery ?? []) deliveries.set(idKey(String(r.order_id)), r);
  const returned = new Set<string>();
  for (const r of x.records.returns ?? []) returned.add(idKey(String(r.order_id)));

  const hasCustomerId = !!oh.customer_id;
  const hasProductId = !!oh.product_id;
  const hasOrderId = !!oh.order_id;
  const ch = x.headers.customers ?? {};
  const ph = x.headers.products ?? {};
  const hasSegment = !!ch.segment || !!oh.segment;
  const hasChannel = !!ch.acquisition_channel || !!oh.channel;
  const hasCountry = !!oh.country || !!ch.country;
  const hasCategory = !!ph.category || !!oh.category;
  const hasCost = !!ph.cost || !!oh.unit_cost;
  const hasShipping = !!oh.shipping_cost;
  const hasDiscountColumn = !!oh.discount;
  const hasDelivery = !!x.records.delivery || !!oh.delivery_date;
  const hasReturns = !!x.records.returns;
  facts.hasSignupDates = !!ch.signup_date;

  const discounts = hasDiscountColumn ? orderRecs.map((r) => num(r, "discount")).filter((v): v is number => v !== null) : [];
  const mode = hasDiscountColumn ? detectDiscountMode(oh.discount, discounts) : null;
  facts.discountMode = mode;

  const countries = new Canon(toCountry);
  const segments = new Canon();
  const channels = new Canon();
  const categories = new Canon();
  const names = new Canon();

  // --- Order fact table ----------------------------------------------------------------------
  const sorted = [...orderRecs].sort((a, b) => (a.order_date as number) - (b.order_date as number));
  const customerIndex = new Map<string, number>();
  const customers: (Customer & { firstOrderWeek: number })[] = [];
  const productStats = new Map<string, { id: string; name: string; category: string; prices: number[]; cost: number; revenue: number }>();
  const orderIds = new Set<string>();
  const orders: OrderRow[] = [];
  const costKnown: boolean[] = [];
  let costRevenue = 0;
  let costList = 0;
  let costSum = 0;
  let totalRevenue = 0;
  let deliveredCount = 0;

  for (const r of sorted) {
    const week = weekOf(r.order_date as number);
    if (week < 0) {
      facts.leadingRowsDropped++;
      continue;
    }
    const quantity = num(r, "quantity") ?? 1;
    const unitPrice = num(r, "unit_price");
    const amount = num(r, "amount");
    let d = num(r, "discount") ?? 0;
    if (d < 0 || (mode === "fraction" && d >= 1) || (mode === "percent" && d >= 100)) {
      facts.discountOutOfRange++;
      d = 0;
    }
    const rate = mode === "fraction" ? d : mode === "percent" ? d / 100 : null;
    let listAmount: number;
    let discountAmount: number;
    if (unitPrice !== null) {
      listAmount = quantity * unitPrice;
      discountAmount = rate !== null ? listAmount * rate : mode === "amount" ? Math.min(d, listAmount) : amount !== null ? Math.max(0, listAmount - amount) : 0;
    } else {
      // Only a line total is known: it is taken as the amount charged, after discount.
      const net = amount!;
      listAmount = rate !== null ? net / (1 - rate) : net + (mode === "amount" ? d : 0);
      discountAmount = listAmount - net;
    }
    const revenue = listAmount - discountAmount;

    const customerKey = hasCustomerId && r.customer_id !== null ? idKey(String(r.customer_id)) : null;
    const cRec = customerKey ? customerRecs.get(customerKey) : undefined;
    const country = countries.of(str(r, "country") ?? (cRec ? str(cRec, "country") : null)) ?? UNKNOWN;
    const segment = segments.of((cRec ? str(cRec, "segment") : null) ?? str(r, "segment")) ?? UNKNOWN;
    const channel = channels.of((cRec ? str(cRec, "acquisition_channel") : null) ?? str(r, "channel")) ?? UNKNOWN;

    let customerId = -1;
    let isFirst: 0 | 1 = 0;
    if (customerKey) {
      const known = customerIndex.get(customerKey);
      if (known === undefined) {
        customerId = customers.length;
        customerIndex.set(customerKey, customerId);
        const signup = cRec ? num(cRec, "signup_date") : null;
        const acquiredWeek = signup !== null ? Math.min(week, weekOf(signup)) : week;
        customers.push({ id: customerId, country, segment: segment as SegmentId, channel: channel as ChannelId, acquiredWeek, firstOrderWeek: week });
        // A customer who signed up before the data begins is not new, even on their first visible order.
        isFirst = acquiredWeek >= 0 ? 1 : 0;
      } else customerId = known;
    }

    const productKey = hasProductId && r.product_id !== null ? idKey(String(r.product_id)) : null;
    const pRec = productKey ? productRecs.get(productKey) : undefined;
    const product = names.of((pRec ? str(pRec, "product_name") : null) ?? str(r, "product_name") ?? (r.product_id !== null && r.product_id !== undefined ? String(r.product_id) : null)) ?? UNKNOWN;
    const category = categories.of((pRec ? str(pRec, "category") : null) ?? str(r, "category")) ?? UNKNOWN;
    const unitCost = (pRec ? num(pRec, "cost") : null) ?? num(r, "unit_cost");
    const cogs = unitCost !== null && unitCost >= 0 ? quantity * unitCost : NaN;
    if (Number.isFinite(cogs)) {
      costRevenue += revenue;
      costList += listAmount;
      costSum += cogs;
    }
    costKnown.push(Number.isFinite(cogs));
    totalRevenue += revenue;

    const orderKey = hasOrderId && r.order_id !== null ? idKey(String(r.order_id)) : null;
    if (orderKey) orderIds.add(orderKey);
    const del = orderKey ? deliveries.get(orderKey) : undefined;
    const deliveredAt = (del ? num(del, "delivery_date") : null) ?? num(r, "delivery_date");
    let deliveryDays = 0;
    let delivered: 0 | 1 = 0;
    let promisedDays = NaN;
    if (deliveredAt !== null) {
      const days = (deliveredAt - (r.order_date as number)) / DAY;
      if (days < 0) facts.deliveredBeforeOrdered++;
      else {
        deliveryDays = days;
        delivered = 1;
        deliveredCount++;
        const promised = del ? num(del, "promised_date") : null;
        if (promised !== null && promised >= (r.order_date as number)) promisedDays = (promised - (r.order_date as number)) / DAY;
      }
    }

    const stats = productStats.get(product) ?? { id: productKey ?? product, name: product, category, prices: [], cost: unitCost ?? 0, revenue: 0 };
    if (stats.prices.length < 200) stats.prices.push(listAmount / quantity);
    stats.revenue += revenue;
    productStats.set(product, stats);

    orders.push({
      id: orders.length, customerId, week, country, region: "", category: category as CategoryId, product,
      segment: segment as SegmentId, channel: channel as ChannelId, quantity, listAmount, discountAmount, revenue,
      cogs, shipping: num(r, "shipping_cost") ?? 0, profit: 0, promisedDays, deliveryDays, delivered,
      returned: orderKey && returned.has(orderKey) ? 1 : 0, isFirst, eligible: 0, repurchased: 0,
    });
  }
  if (orders.length === 0) return fail("no-rows");

  // --- Cost, promise and profit ----------------------------------------------------------------
  facts.costCoverage = hasCost && totalRevenue > 0 ? costRevenue / totalRevenue : 0;
  const costRatio = costList > 0 ? costSum / costList : 0;
  // The typical delivery time of each country stands in for the promise when none was given.
  const typical = new Map<string, number>();
  if (deliveredCount > 0) {
    const byCountry = new Map<string, number[]>();
    for (const o of orders) if (o.delivered) (byCountry.get(o.country) ?? byCountry.set(o.country, []).get(o.country)!).push(o.deliveryDays);
    for (const [c, days] of byCountry) typical.set(c, median(days));
  }
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (!costKnown[i]) {
      // Orders without a known cost take the average cost-to-list ratio of the rest, and are reported.
      o.cogs = o.listAmount * costRatio;
      if (hasCost) facts.costImputed++;
    }
    if (!Number.isFinite(o.promisedDays)) {
      o.promisedDays = typical.get(o.country) ?? 0;
      if (o.delivered) facts.promisedFromData = true;
    }
    if (!o.delivered) o.deliveryDays = o.promisedDays;
    if (o.returned) facts.returnsMatched++;
    o.profit = o.returned ? -(2 * o.shipping + 0.25 * o.cogs) : o.revenue - o.cogs - o.shipping;
  }
  facts.deliveryCoverage = deliveredCount / orders.length;
  facts.linesPerOrder = hasOrderId && orderIds.size > 0 ? orders.length / orderIds.size : 1;
  facts.mergedSpellings = countries.merged + segments.merged + channels.merged + categories.merged;
  if (hasCustomerId) markRepurchases(orders, weeks);

  // --- Marketing: weekly spend joined with the customers each channel acquired ---------------------
  const mh = x.headers.marketing ?? {};
  const marketingRecs = x.records.marketing ?? [];
  const hasMarketing = !!x.records.marketing && marketingRecs.length > 0;
  const marketingByCountry = hasMarketing ? !!mh.country : hasCountry;
  const cell = new Map<string, MarketingRow>();
  const at = (week: number, country: string, channel: string): MarketingRow => {
    const key = `${week}|${country}|${channel}`;
    let row = cell.get(key);
    if (!row) cell.set(key, (row = { week, country, channel: channel as ChannelId, spend: 0, newCustomers: 0 }));
    return row;
  };
  const acquiring = new Set<string>();
  for (const c of customers) {
    if (c.acquiredWeek < 0) continue;
    acquiring.add(c.channel);
    at(c.acquiredWeek, marketingByCountry ? c.country : "All", hasChannel ? c.channel : "All").newCustomers++;
  }
  const spendByChannel = new Map<string, number>();
  let spendTotal = 0;
  for (const r of marketingRecs) {
    const week = weekOf(r.date as number);
    if (week < 0 || week >= weeks) continue;
    const channel = channels.of(str(r, "channel")) ?? UNKNOWN;
    const spend = num(r, "spend") ?? 0;
    at(week, marketingByCountry ? (countries.of(str(r, "country")) ?? UNKNOWN) : "All", channel).spend += spend;
    spendByChannel.set(channel, (spendByChannel.get(channel) ?? 0) + spend);
    spendTotal += spend;
    if (!acquiring.has(channel)) facts.unattributedSpend += spend;
  }
  const marketing = [...cell.values()].sort((a, b) => a.week - b.week);
  const attributed = spendTotal > 0 ? 1 - facts.unattributedSpend / spendTotal : 0;

  // --- What this data can support ------------------------------------------------------------------
  const several = (c: Canon) => c.size >= 2;
  const metrics = ["revenue", "orders", "aov"];
  if (facts.costCoverage >= MIN_COST_COVERAGE) metrics.push("margin");
  if (hasDiscountColumn || (!!oh.unit_price && !!oh.amount)) metrics.push("discount");
  if (hasDelivery && facts.deliveryCoverage >= MIN_DELIVERY_COVERAGE) metrics.push("delivery", "onTime");
  if (hasReturns && facts.returnsMatched > 0) metrics.push("returns");
  if (hasCustomerId) metrics.push("repurchase", "newShare", "acquisitions");
  if (hasShipping) metrics.push("shipping");
  if (hasMarketing && spendTotal > 0) metrics.push("spend");
  if (hasMarketing && hasCustomerId && hasChannel && attributed >= 0.5) metrics.push("cac");

  const orderDims: string[] = [];
  if (hasCountry && several(countries)) orderDims.push("country");
  if (hasCategory && several(categories)) orderDims.push("category");
  if ((hasProductId || !!oh.product_name) && several(names)) orderDims.push("product");
  if (hasSegment && several(segments)) orderDims.push("segment");
  if (hasChannel && several(channels)) orderDims.push("channel");
  const marketingDims: string[] = [];
  if (marketingByCountry && several(countries)) marketingDims.push("country");
  if ((hasChannel || hasMarketing) && several(channels)) marketingDims.push("channel");
  const availability: Availability = { metrics, dims: { orders: orderDims, marketing: marketingDims }, currency };

  // --- Reference lists the interface reads ---------------------------------------------------------
  const revenueByCountry = new Map<string, number>();
  for (const o of orders) revenueByCountry.set(o.country, (revenueByCountry.get(o.country) ?? 0) + o.revenue);
  const data: Dataset = {
    company, seed: hash(`${orders.length}|${startDate}|${Math.round(totalRevenue)}`) % 100000, weeks, startDate, available: availability,
    regions: [],
    countries: [...revenueByCountry].sort((a, b) => b[1] - a[1]).map(([name, revenue]) => ({
      code: name, name, region: "", demandWeight: revenue / totalRevenue, baseDeliveryDays: typical.get(name) ?? 0, shippingCost: 0, returnAdj: 0,
    })),
    products: [...productStats.values()].sort((a, b) => b.revenue - a.revenue).map((p) => ({
      id: p.id, name: p.name, category: p.category as CategoryId, listPrice: median(p.prices), unitCost: p.cost, freight: false, weight: p.revenue / totalRevenue,
    })),
    channels: [...new Set([...customers.map((c) => c.channel as string), ...spendByChannel.keys()])].map((id) => ({
      id: id as ChannelId, paid: (spendByChannel.get(id) ?? 0) > 0, weeklySpend: (spendByChannel.get(id) ?? 0) / weeks,
      weeklyAcquisitions: customers.filter((c) => c.channel === id && c.acquiredWeek >= 0).length / weeks, baseDiscount: 0,
    })),
    customers: customers.map(({ id, country, segment, channel, acquiredWeek }) => ({ id, country, segment, channel, acquiredWeek })),
    orders, marketing,
  };

  const summary: Summary = {
    customers: customers.length, orders: hasOrderId ? orderIds.size : orders.length, orderLines: orders.length,
    products: productStats.size, countries: hasCountry ? countries.size : 0, weeks, months: Math.round((weeks * 7) / 30.44),
    from: startDate, to: isoDay(last), revenue: totalRevenue,
  };
  return { data, summary, availability, facts, blockers: [] };
}

export { keyOf };
