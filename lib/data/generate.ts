import type { Customer, Dataset, MarketingRow, OrderRow } from "@/types/domain";
import { BURN_IN_WEEKS, CHANNELS, COUNTRIES, PRODUCTS, REGIONS, REPURCHASE_WEEKS, SCENARIOS, SEGMENTS, START_DATE, WEEKS } from "./catalog";
import { Rng } from "./rng";

/**
 * Agent-based generator: customers are acquired week by week through
 * marketing channels, then repeatedly decide whether to buy. Every outcome
 * (discount, delivery time, return, churn) is drawn conditionally on the
 * variables that would drive it in a real business, so relationships in the
 * data are structural rather than independent noise.
 */

const FREIGHT_EXTRA_DAYS = 4;
const FREIGHT_SHIPPING = 34;
const ACQ_ELASTICITY = 0.6;
const BACKGROUND_CHURN = 0.008;

function seasonality(week: number): number {
  const d = new Date(START_DATE);
  d.setUTCDate(d.getUTCDate() + week * 7);
  const m = d.getUTCMonth();
  if (m === 10) return 1.22;
  if (m === 11) return 1.32;
  if (m === 0) return 0.9;
  return 1;
}

interface LiveCustomer extends Customer {
  alive: boolean;
  /** Multiplier on the segment's weekly purchase probability. */
  appetite: number;
}

export function generateDataset(seed = 2026): Dataset {
  const rng = new Rng(seed);
  const customers: LiveCustomer[] = [];
  const orders: OrderRow[] = [];
  const marketing: MarketingRow[] = [];
  const countryByCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  const segByShare = SEGMENTS.map((s) => s.share);
  const segById = new Map(SEGMENTS.map((s) => [s.id, s]));
  const { freightDisruption, socialPromo, searchSaturation, smartHomePartnership } = SCENARIOS;
  const weights = new Float64Array(PRODUCTS.length);

  const placeOrder = (c: LiveCustomer, week: number, isFirst: boolean): void => {
    if (week < 0) {
      // Burn-in: only the customer lifecycle matters, no order is recorded.
      if (rng.next() < segById.get(c.segment)!.baseChurn) c.alive = false;
      return;
    }
    const seg = segById.get(c.segment)!;
    const country = countryByCode.get(c.country)!;
    const partner =
      week >= smartHomePartnership.startWeek &&
      c.channel === smartHomePartnership.channel &&
      (smartHomePartnership.countries as readonly string[]).includes(c.country);

    let total = 0;
    for (let i = 0; i < PRODUCTS.length; i++) {
      const pr = PRODUCTS[i];
      let w = pr.weight * seg.affinity[pr.category];
      if (partner && pr.category === smartHomePartnership.category) w *= smartHomePartnership.affinityFactor;
      weights[i] = w;
      total += w;
    }
    const product = PRODUCTS[rng.pick(weights, total)];

    const disrupted = product.freight && c.country === freightDisruption.country && week >= freightDisruption.startWeek;
    // A longer quoted delivery time on the product page costs conversions.
    if (disrupted && rng.next() > Math.exp(-seg.delayConversion)) return;

    const quantity = 1 + Math.floor(rng.next() * rng.next() * seg.maxQuantity);
    const channel = CHANNELS.find((ch) => ch.id === c.channel)!;
    const promo = c.channel === socialPromo.channel && week >= socialPromo.startWeek;
    const discountPct = Math.min(0.5, Math.max(0, (promo ? socialPromo.discount : channel.baseDiscount) + 0.025 * rng.normal()));

    const listAmount = quantity * product.listPrice;
    const discountAmount = Math.round(listAmount * discountPct * 100) / 100;
    const revenue = listAmount - discountAmount;
    const cogs = quantity * product.unitCost;
    const shipping = product.freight ? FREIGHT_SHIPPING + country.shippingCost * 2 : country.shippingCost * (1 + 0.15 * (quantity - 1));

    const promisedDays = country.baseDeliveryDays + (product.freight ? FREIGHT_EXTRA_DAYS : 0);
    let deliveryDays = promisedDays * Math.exp(0.22 * rng.normal() - 0.02);
    if (disrupted) deliveryDays += Math.max(2, freightDisruption.extraDays + 2 * rng.normal());
    deliveryDays = Math.max(1, Math.round(deliveryDays * 10) / 10);
    const delay = Math.max(0, deliveryDays - promisedDays - 1);

    const baseReturn = { "Home Office": 0.05, Audio: 0.07, Wearables: 0.09, "Smart Home": 0.06, Accessories: 0.03 }[product.category];
    const returned = rng.next() < Math.min(0.6, baseReturn + country.returnAdj + 0.012 * delay) ? 1 : 0;
    const profit = returned ? -(2 * shipping + 0.25 * cogs) : revenue - cogs - shipping;

    orders.push({
      id: orders.length, customerId: c.id, week, country: country.name, region: country.region,
      category: product.category, product: product.name, segment: c.segment, channel: c.channel,
      quantity, listAmount, discountAmount, revenue, cogs, shipping, profit: Math.round(profit * 100) / 100,
      promisedDays, deliveryDays, returned, isFirst: isFirst ? 1 : 0, eligible: 0, repurchased: 0,
    });
    // The delivery experience and a return both raise the chance of churn.
    const churn = seg.baseChurn + seg.delayChurnPerDay * delay + (returned ? 0.1 : 0);
    if (rng.next() < Math.min(0.9, churn)) c.alive = false;
  };

  for (let week = -BURN_IN_WEEKS; week < WEEKS; week++) {
    const season = seasonality(week);
    const growth = 1 + 0.0015 * Math.max(0, week);

    // Existing customers decide whether to buy this week.
    const existing = customers.length;
    for (let i = 0; i < existing; i++) {
      const c = customers[i];
      if (!c.alive) continue;
      if (rng.next() < BACKGROUND_CHURN) {
        c.alive = false;
        continue;
      }
      if (rng.next() < segById.get(c.segment)!.weeklyPurchase * season * c.appetite) placeOrder(c, week, false);
    }

    // Acquisition: spend → new customers, with diminishing returns.
    for (const ch of CHANNELS) {
      const saturated = ch.id === searchSaturation.channel && week >= searchSaturation.startWeek;
      const promo = ch.id === socialPromo.channel && week >= socialPromo.startWeek;
      const spendFactor = (saturated ? searchSaturation.spendFactor : 1) * (ch.paid ? growth : 1) * (1 + 0.06 * rng.normal());
      const efficiency = (saturated ? searchSaturation.efficiency : 1) * (promo ? socialPromo.acquisitionFactor : 1);
      for (const country of COUNTRIES) {
        const partner =
          ch.id === smartHomePartnership.channel &&
          week >= smartHomePartnership.startWeek &&
          (smartHomePartnership.countries as readonly string[]).includes(country.code);
        const spend = ch.weeklySpend * spendFactor * country.demandWeight * (partner ? 1.5 : 1);
        const response = ch.paid ? Math.pow(spendFactor, ACQ_ELASTICITY) * efficiency : growth;
        const lambda = ch.weeklyAcquisitions * country.demandWeight * response * season * (partner ? smartHomePartnership.acquisitionFactor : 1);
        const n = rng.poisson(lambda);
        marketing.push({ week, country: country.name, channel: ch.id, spend: Math.round(spend), newCustomers: n });
        for (let k = 0; k < n; k++) {
          const c: LiveCustomer = {
            id: customers.length, country: country.code, segment: SEGMENTS[rng.pick(segByShare, 1)].id,
            channel: ch.id, acquiredWeek: week, alive: true,
            appetite: promo ? socialPromo.repeatFactor : 1,
          };
          customers.push(c);
          placeOrder(c, week, true);
        }
      }
    }
  }

  markRepurchases(orders);

  return {
    company: "NOVA", seed, weeks: WEEKS, startDate: START_DATE, regions: REGIONS, countries: COUNTRIES,
    products: PRODUCTS, channels: CHANNELS,
    customers: customers.map(({ id, country, segment, channel, acquiredWeek }) => ({ id, country, segment, channel, acquiredWeek })),
    orders, marketing,
  };
}

/** Flags, for each order, whether the customer came back within the follow-up window. */
export function markRepurchases(orders: OrderRow[], weeks = WEEKS): void {
  const next = new Map<number, number>();
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    const nextWeek = next.get(o.customerId);
    o.eligible = o.week + REPURCHASE_WEEKS < weeks ? 1 : 0;
    o.repurchased = o.eligible && nextWeek !== undefined && nextWeek - o.week <= REPURCHASE_WEEKS ? 1 : 0;
    next.set(o.customerId, o.week);
  }
}
