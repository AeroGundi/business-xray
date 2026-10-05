/**
 * Domain model for NOVA, the fictional e-commerce retailer.
 * Reference entities are small lookup tables; `OrderRow` is the denormalised
 * fact table (star-schema join of Order + OrderItem + Delivery + Return)
 * that the analytics layer aggregates over.
 */

export type SegmentId = "Consumer" | "Prosumer" | "SME";
export type ChannelId = "Organic" | "Paid Search" | "Paid Social" | "Email" | "Affiliates" | "Direct";
export type CategoryId = "Home Office" | "Audio" | "Wearables" | "Smart Home" | "Accessories";

export interface Region {
  id: string;
  name: string;
}

export interface Country {
  code: string;
  name: string;
  region: string;
  /** Share of baseline demand. */
  demandWeight: number;
  /** Promised parcel delivery time, days. */
  baseDeliveryDays: number;
  /** Outbound shipping cost of a parcel-class order, EUR. */
  shippingCost: number;
  /** Additive adjustment to return probability. */
  returnAdj: number;
}

export interface Product {
  id: string;
  name: string;
  category: CategoryId;
  listPrice: number;
  unitCost: number;
  /** Oversized item shipped by freight carrier rather than parcel. */
  freight: boolean;
  /** Relative baseline popularity. */
  weight: number;
}

export interface MarketingChannel {
  id: ChannelId;
  paid: boolean;
  /** Baseline weekly spend across all countries, EUR. */
  weeklySpend: number;
  /** Baseline weekly acquisitions across all countries. */
  weeklyAcquisitions: number;
  /** Typical discount depth offered to customers of this channel. */
  baseDiscount: number;
}

export interface Customer {
  id: number;
  country: string;
  segment: SegmentId;
  /** First-touch acquisition channel. */
  channel: ChannelId;
  acquiredWeek: number;
}

/** One order line with its delivery and return outcome joined in. */
export interface OrderRow {
  id: number;
  customerId: number;
  week: number;
  country: string;
  region: string;
  category: CategoryId;
  product: string;
  segment: SegmentId;
  channel: ChannelId;
  quantity: number;
  /** quantity × list price, before discount. */
  listAmount: number;
  discountAmount: number;
  /** Booked revenue = listAmount − discountAmount. */
  revenue: number;
  cogs: number;
  shipping: number;
  /** Contribution profit after COGS, shipping and return losses. */
  profit: number;
  promisedDays: number;
  deliveryDays: number;
  /** 0 when no delivery was recorded for the order (uploaded data only); absent means delivered. */
  delivered?: 0 | 1;
  returned: 0 | 1;
  /** First order of this customer. */
  isFirst: 0 | 1;
  /** Follow-up window fully observed (not right-censored). */
  eligible: 0 | 1;
  /** Customer ordered again within REPURCHASE_WEEKS. */
  repurchased: 0 | 1;
}

/** Weekly marketing spend and acquisitions per channel × country. */
export interface MarketingRow {
  week: number;
  country: string;
  channel: ChannelId;
  spend: number;
  newCustomers: number;
}

/** What an uploaded dataset can support. Absent on the demo business, which supports everything. */
export interface Availability {
  /** Metric ids (lib/analytics/metrics) that can be computed from the data. */
  metrics: string[];
  /** Dimensions each fact table can be broken down by. */
  dims: { orders: string[]; marketing: string[] };
  /** Currency symbol used for display. */
  currency: string;
}

export interface Dataset {
  company: string;
  /** Present when the data was uploaded rather than generated. */
  available?: Availability;
  seed: number;
  weeks: number;
  /** ISO date (Monday) of week 0. */
  startDate: string;
  regions: Region[];
  countries: Country[];
  products: Product[];
  channels: MarketingChannel[];
  customers: Customer[];
  orders: OrderRow[];
  marketing: MarketingRow[];
}
