import type { CategoryId, ChannelId, Country, MarketingChannel, Product, Region, SegmentId } from "@/types/domain";

/** Reference data and behavioural parameters of the synthetic NOVA business. */

export const WEEKS = 78;
export const START_DATE = "2025-03-31";
export const REPURCHASE_WEEKS = 5;
/** Weeks simulated before week 0 so the customer base starts near steady state. */
export const BURN_IN_WEEKS = 104;

export const REGIONS: Region[] = [
  { id: "DACH", name: "DACH" },
  { id: "France", name: "France" },
  { id: "UK", name: "United Kingdom" },
  { id: "Iberia", name: "Iberia" },
  { id: "Italy", name: "Italy" },
  { id: "Benelux", name: "Benelux" },
  { id: "Nordics", name: "Nordics" },
];

export const COUNTRIES: Country[] = [
  { code: "DE", name: "Germany", region: "DACH", demandWeight: 0.21, baseDeliveryDays: 3.0, shippingCost: 5.5, returnAdj: 0 },
  { code: "FR", name: "France", region: "France", demandWeight: 0.18, baseDeliveryDays: 3.5, shippingCost: 6.0, returnAdj: 0 },
  { code: "GB", name: "United Kingdom", region: "UK", demandWeight: 0.13, baseDeliveryDays: 5.5, shippingCost: 14.5, returnAdj: 0.045 },
  { code: "ES", name: "Spain", region: "Iberia", demandWeight: 0.12, baseDeliveryDays: 4.0, shippingCost: 6.5, returnAdj: 0 },
  { code: "IT", name: "Italy", region: "Italy", demandWeight: 0.11, baseDeliveryDays: 4.5, shippingCost: 7.0, returnAdj: 0.005 },
  { code: "NL", name: "Netherlands", region: "Benelux", demandWeight: 0.09, baseDeliveryDays: 2.5, shippingCost: 5.0, returnAdj: 0 },
  { code: "SE", name: "Sweden", region: "Nordics", demandWeight: 0.06, baseDeliveryDays: 4.5, shippingCost: 8.5, returnAdj: 0 },
  { code: "AT", name: "Austria", region: "DACH", demandWeight: 0.06, baseDeliveryDays: 3.5, shippingCost: 6.0, returnAdj: 0 },
  { code: "PT", name: "Portugal", region: "Iberia", demandWeight: 0.04, baseDeliveryDays: 4.5, shippingCost: 7.0, returnAdj: 0 },
];

const p = (
  id: string, name: string, category: CategoryId, listPrice: number, unitCost: number, weight: number, freight = false,
): Product => ({ id, name, category, listPrice, unitCost, weight, freight });

export const PRODUCTS: Product[] = [
  p("atlas-desk", "Atlas Standing Desk", "Home Office", 549, 318, 2.0, true),
  p("forma-chair", "Forma Task Chair", "Home Office", 329, 190, 0.9),
  p("arc-arm", "Arc Monitor Arm", "Home Office", 119, 52, 0.8),
  p("lumen-lamp", "Lumen Desk Lamp", "Home Office", 79, 31, 0.9),
  p("sonus-pro", "Sonus Pro Headphones", "Audio", 279, 140, 1.2),
  p("sonus-buds", "Sonus Buds", "Audio", 129, 58, 1.7),
  p("cantor-speaker", "Cantor Speaker", "Audio", 199, 104, 0.9),
  p("studio-mic", "Studio Mic", "Audio", 149, 70, 0.6),
  p("pulse-watch", "Pulse Watch", "Wearables", 249, 138, 1.2),
  p("pulse-band", "Pulse Band", "Wearables", 89, 36, 1.4),
  p("halo-ring", "Halo Ring", "Wearables", 299, 150, 0.5),
  p("hearth-hub", "Hearth Hub", "Smart Home", 159, 84, 0.8),
  p("vigil-cam", "Vigil Camera", "Smart Home", 99, 47, 0.9),
  p("thermo-one", "Thermo One", "Smart Home", 189, 92, 0.6),
  p("glow-bulbs", "Glow Bulb 4-Pack", "Smart Home", 49, 19, 1.0),
  p("volt-charger", "Volt Charger", "Accessories", 39, 12, 1.8),
  p("carry-sleeve", "Carry Sleeve", "Accessories", 45, 14, 1.2),
  p("link-dock", "Link Dock", "Accessories", 139, 66, 0.9),
  p("type-keyboard", "Type Keyboard", "Accessories", 109, 49, 1.0),
];

export const CHANNELS: MarketingChannel[] = [
  { id: "Organic", paid: false, weeklySpend: 900, weeklyAcquisitions: 54, baseDiscount: 0.03 },
  { id: "Paid Search", paid: true, weeklySpend: 4200, weeklyAcquisitions: 50, baseDiscount: 0.04 },
  { id: "Paid Social", paid: true, weeklySpend: 3400, weeklyAcquisitions: 44, baseDiscount: 0.08 },
  { id: "Email", paid: false, weeklySpend: 500, weeklyAcquisitions: 18, baseDiscount: 0.1 },
  { id: "Affiliates", paid: true, weeklySpend: 1500, weeklyAcquisitions: 26, baseDiscount: 0.06 },
  { id: "Direct", paid: false, weeklySpend: 0, weeklyAcquisitions: 32, baseDiscount: 0.03 },
];

export interface SegmentParams {
  id: SegmentId;
  share: number;
  /** Weekly probability that an active customer places an order. */
  weeklyPurchase: number;
  /** Probability of churning after an order delivered on time. */
  baseChurn: number;
  /** Extra churn probability per day of delivery delay. */
  delayChurnPerDay: number;
  /** Conversion loss sensitivity to a longer quoted delivery time. */
  delayConversion: number;
  /** Category affinity multipliers. */
  affinity: Record<CategoryId, number>;
  maxQuantity: number;
}

export const SEGMENTS: SegmentParams[] = [
  {
    id: "Consumer", share: 0.62, weeklyPurchase: 0.034, baseChurn: 0.14, delayChurnPerDay: 0.02, delayConversion: 0.35,
    affinity: { "Home Office": 0.55, Audio: 1.3, Wearables: 1.3, "Smart Home": 1.0, Accessories: 1.1 }, maxQuantity: 1,
  },
  {
    id: "Prosumer", share: 0.26, weeklyPurchase: 0.05, baseChurn: 0.1, delayChurnPerDay: 0.025, delayConversion: 0.45,
    affinity: { "Home Office": 1.2, Audio: 1.2, Wearables: 0.9, "Smart Home": 1.0, Accessories: 1.0 }, maxQuantity: 2,
  },
  {
    id: "SME", share: 0.12, weeklyPurchase: 0.075, baseChurn: 0.07, delayChurnPerDay: 0.05, delayConversion: 1.6,
    affinity: { "Home Office": 3.4, Audio: 0.5, Wearables: 0.15, "Smart Home": 0.4, Accessories: 1.5 }, maxQuantity: 3,
  },
];

/**
 * Planted scenarios — the ground truth the analytics engine is expected to
 * rediscover. Nothing downstream reads these; they only shape generation.
 */
export const SCENARIOS = {
  /** Freight carrier disruption for oversized items shipped to Germany. */
  freightDisruption: { country: "DE", startWeek: 68, extraDays: 9 },
  /**
   * Deep-discount promotion run for Paid Social audiences. It converts well,
   * but the customers it attracts are bargain hunters who rarely come back.
   */
  socialPromo: { channel: "Paid Social" as ChannelId, startWeek: 68, discount: 0.24, acquisitionFactor: 1.8, repeatFactor: 0.1 },
  /** Paid Search budget scaled into a saturated, more competitive auction. */
  searchSaturation: { channel: "Paid Search" as ChannelId, startWeek: 67, spendFactor: 1.5, efficiency: 0.72 },
  /** Affiliate partnership driving Smart Home demand in Southern Europe. */
  smartHomePartnership: {
    countries: ["ES", "IT"], channel: "Affiliates" as ChannelId, category: "Smart Home" as CategoryId,
    startWeek: 68, acquisitionFactor: 5, affinityFactor: 6,
  },
} as const;
