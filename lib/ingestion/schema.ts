/**
 * CANONICAL MODEL — the tables and fields BUSINESS X-RAY understands for an
 * e-commerce business. User files are mapped onto this model; the analytics
 * engine only ever sees data that has been normalised into it.
 *
 * `names` are the header vocabularies used by schema detection: English and
 * Spanish terms a business would plausibly use for the field.
 */

export type TableId = "orders" | "customers" | "products" | "delivery" | "marketing" | "returns";
export type FieldType = "id" | "date" | "number" | "integer" | "text" | "country";
/** required: the analysis cannot run without it. core: needed for the full X-Ray. extra: unlocks further analysis. */
export type FieldLevel = "required" | "core" | "extra";

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  level: FieldLevel;
  /** Shown in the template guide. */
  meaning: string;
  /** Listed in the downloadable template (the rest are understood if present). */
  template: boolean;
  names: string[];
}

export interface Table {
  id: TableId;
  label: string;
  /** Singular and plural noun for one row. */
  row: string;
  rows: string;
  importance: "required" | "recommended" | "optional";
  purpose: string;
  /** Words in a file name that suggest this table. */
  fileNames: string[];
  fields: Field[];
}

const f = (id: string, label: string, type: FieldType, level: FieldLevel, meaning: string, names: string[], template = true): Field =>
  ({ id, label, type, level, meaning, template, names });

export const TABLES: Table[] = [
  {
    id: "orders", label: "Orders", row: "order line", rows: "order lines", importance: "required",
    purpose: "What was sold, to whom, when and for how much. Everything else connects to this.",
    fileNames: ["order", "orders", "pedido", "pedidos", "venta", "ventas", "sale", "sales", "transaction", "transactions", "transacciones", "facturas", "invoices"],
    fields: [
      f("order_id", "Order ID", "id", "core", "Identifier of the order. Repeats when an order has several products.",
        ["order id", "order", "order number", "order no", "order ref", "id pedido", "pedido", "numero pedido", "n pedido", "num pedido", "transaction id", "invoice", "invoice id", "invoice number", "factura", "id venta", "sale id", "ticket"]),
      f("customer_id", "Customer ID", "id", "core", "Who bought. Must match the customer file if you provide one.",
        ["customer id", "customer", "client", "client id", "cliente", "id cliente", "codigo cliente", "cod cliente", "buyer", "buyer id", "user id", "user", "account", "account id", "customer number", "customer email", "email"]),
      f("product_id", "Product ID", "id", "core", "What was bought. Must match the product file if you provide one.",
        ["product id", "product", "producto", "id producto", "codigo producto", "cod producto", "sku", "item", "item id", "article", "articulo", "referencia", "product code", "product sku"]),
      f("order_date", "Order date", "date", "required", "When the order was placed.",
        ["order date", "date", "fecha", "fecha pedido", "fecha de pedido", "fecha compra", "fecha de compra", "fecha venta", "purchase date", "purchased at", "created at", "created", "order created", "ordered at", "sale date", "transaction date", "invoice date", "fecha factura", "day"]),
      f("quantity", "Quantity", "integer", "core", "Units of the product in this order line.",
        ["quantity", "qty", "units", "unidades", "cantidad", "cant", "items", "count", "pieces", "uds"]),
      f("unit_price", "Unit price", "number", "required", "List price of one unit, before discount.",
        ["unit price", "price", "precio", "precio unitario", "precio unidad", "pvp", "list price", "item price", "price per unit", "importe unitario", "tarifa"]),
      f("discount", "Discount", "number", "core", "Discount on the line: a fraction (0.10), a percentage (10) or an amount.",
        ["discount", "descuento", "dto", "discount pct", "discount percent", "discount rate", "discount amount", "promo", "promotion", "rebate", "rebaja"]),
      f("country", "Country", "country", "core", "Where the order was shipped.",
        ["country", "pais", "country code", "ship country", "shipping country", "destination", "destino", "market", "mercado", "region", "nation", "territory", "delivery country", "pais envio"]),
      f("amount", "Line total", "number", "extra", "Amount charged for the line after discount. Used when no unit price is given.",
        ["amount", "total", "line total", "importe", "importe total", "revenue", "ingresos", "sales", "ventas", "net amount", "subtotal", "total price", "order value", "order total", "value", "valor", "facturacion"], false),
      f("unit_cost", "Unit cost", "number", "extra", "What one unit costs you. Unlocks profitability when there is no product file.",
        ["unit cost", "cost", "coste", "costo", "coste unitario", "cogs", "cost price", "purchase price", "precio compra", "precio coste"], false),
      f("shipping_cost", "Shipping cost", "number", "extra", "What shipping this order cost you.",
        ["shipping cost", "shipping", "freight", "freight cost", "delivery cost", "coste envio", "gastos envio", "envio", "portes", "postage"], false),
      f("product_name", "Product name", "text", "extra", "Readable product name.",
        ["product name", "nombre producto", "item name", "description", "descripcion", "product title", "title", "nombre articulo"], false),
      f("category", "Category", "text", "extra", "Product category.",
        ["category", "categoria", "product category", "family", "familia", "department", "departamento", "product type", "line", "linea", "collection"], false),
      f("segment", "Customer segment", "text", "extra", "Type of customer (for example consumer or business).",
        ["segment", "segmento", "customer segment", "customer type", "tipo cliente", "client type", "tier", "customer group", "grupo cliente"], false),
      f("channel", "Sales channel", "text", "extra", "Channel that brought the customer.",
        ["channel", "canal", "acquisition channel", "source", "origen", "fuente", "utm source", "marketing channel", "sales channel", "canal venta", "medium"], false),
      f("delivery_date", "Delivery date", "date", "extra", "When the order reached the customer.",
        ["delivery date", "delivered", "delivered at", "fecha entrega", "fecha de entrega", "entregado", "arrival date", "received date"], false),
    ],
  },
  {
    id: "customers", label: "Customers", row: "customer", rows: "customers", importance: "required",
    purpose: "Who your customers are. Unlocks segmentation, acquisition and retention analysis.",
    fileNames: ["customer", "customers", "cliente", "clientes", "client", "clients", "users", "usuarios", "accounts", "buyers"],
    fields: [
      f("customer_id", "Customer ID", "id", "required", "Identifier of the customer, as used in the orders file.",
        ["customer id", "customer", "client", "client id", "cliente", "id cliente", "codigo cliente", "cod cliente", "id", "user id", "user", "account id", "customer number", "email", "buyer id"]),
      f("signup_date", "Signup date", "date", "core", "When the customer first registered or bought.",
        ["signup date", "sign up date", "signup", "registered", "registration date", "created at", "created", "fecha alta", "fecha de alta", "fecha registro", "fecha de registro", "alta", "first order date", "first purchase", "customer since", "join date", "joined"]),
      f("segment", "Segment", "text", "core", "Type of customer (for example consumer or business).",
        ["segment", "segmento", "customer segment", "customer type", "tipo cliente", "tipo", "type", "client type", "tier", "group", "grupo", "customer group"]),
      f("country", "Country", "country", "core", "Where the customer is based.",
        ["country", "pais", "country code", "market", "mercado", "region", "nation", "location", "ubicacion"]),
      f("acquisition_channel", "Acquisition channel", "text", "core", "Channel that first brought the customer. Must match the marketing file if you provide one.",
        ["acquisition channel", "channel", "canal", "canal adquisicion", "canal captacion", "source", "origen", "fuente", "utm source", "marketing channel", "first touch", "referrer", "medium", "how found"]),
    ],
  },
  {
    id: "products", label: "Products", row: "product", rows: "products", importance: "recommended",
    purpose: "Names, categories and costs. Unlocks category analysis and profitability.",
    fileNames: ["product", "products", "producto", "productos", "catalog", "catalogue", "catalogo", "items", "articulos", "sku", "skus", "inventory"],
    fields: [
      f("product_id", "Product ID", "id", "required", "Identifier of the product, as used in the orders file.",
        ["product id", "product", "producto", "id producto", "codigo producto", "cod producto", "sku", "id", "item id", "item", "article", "articulo", "referencia", "product code", "code", "codigo"]),
      f("product_name", "Product name", "text", "core", "Readable name shown in the analysis.",
        ["product name", "name", "nombre", "nombre producto", "title", "description", "descripcion", "item name", "product title"]),
      f("category", "Category", "text", "core", "Group the product belongs to.",
        ["category", "categoria", "product category", "family", "familia", "department", "departamento", "type", "tipo", "product type", "line", "linea", "collection"]),
      f("cost", "Unit cost", "number", "core", "What one unit costs you. Needed to measure profit.",
        ["cost", "unit cost", "coste", "costo", "coste unitario", "cogs", "cost price", "purchase price", "precio compra", "precio coste", "cost of goods"]),
    ],
  },
  {
    id: "delivery", label: "Delivery", row: "delivery", rows: "deliveries", importance: "recommended",
    purpose: "When orders shipped and arrived. Unlocks delivery performance and logistics root causes.",
    fileNames: ["delivery", "deliveries", "shipping", "shipment", "shipments", "envio", "envios", "entrega", "entregas", "logistics", "logistica", "fulfilment", "fulfillment"],
    fields: [
      f("order_id", "Order ID", "id", "required", "The order that was delivered.",
        ["order id", "order", "order number", "id pedido", "pedido", "numero pedido", "order ref", "shipment order"]),
      f("shipping_date", "Shipping date", "date", "core", "When the order left your warehouse.",
        ["shipping date", "ship date", "shipped", "shipped at", "dispatch date", "dispatched", "fecha envio", "fecha de envio", "fecha salida", "enviado"]),
      f("delivery_date", "Delivery date", "date", "required", "When the order reached the customer.",
        ["delivery date", "delivered", "delivered at", "fecha entrega", "fecha de entrega", "entregado", "arrival date", "received date", "received"]),
      f("promised_date", "Promised date", "date", "extra", "The delivery date the customer was promised.",
        ["promised date", "promised", "estimated delivery", "eta", "expected delivery", "due date", "fecha prometida", "fecha estimada", "fecha prevista"], false),
    ],
  },
  {
    id: "marketing", label: "Marketing", row: "spend record", rows: "spend records", importance: "optional",
    purpose: "What you spent to acquire customers. Unlocks acquisition cost and marketing efficiency.",
    fileNames: ["marketing", "ads", "advertising", "campaign", "campaigns", "campanas", "spend", "publicidad", "media"],
    fields: [
      f("date", "Date", "date", "required", "Day (or first day of the period) the money was spent.",
        ["date", "fecha", "day", "dia", "week", "semana", "period", "periodo", "month", "mes", "spend date"]),
      f("channel", "Channel", "text", "required", "Marketing channel, as used in the customer file.",
        ["channel", "canal", "source", "origen", "fuente", "platform", "plataforma", "medium", "network", "marketing channel", "utm source"]),
      f("spend", "Spend", "number", "required", "Amount spent.",
        ["spend", "cost", "gasto", "inversion", "coste", "budget", "presupuesto", "amount", "importe", "ad spend", "media spend", "investment"]),
      f("campaign", "Campaign", "text", "extra", "Campaign name. Kept for reference.",
        ["campaign", "campana", "campaign name", "ad set", "adset", "ad group", "nombre campana"]),
      f("country", "Country", "country", "extra", "Country the spend targeted.",
        ["country", "pais", "market", "mercado", "region", "geo", "country code"], false),
    ],
  },
  {
    id: "returns", label: "Returns", row: "return", rows: "returns", importance: "optional",
    purpose: "Which orders came back. Unlocks return-rate analysis and a truer profit figure.",
    fileNames: ["return", "returns", "devolucion", "devoluciones", "refund", "refunds", "reembolsos", "rma"],
    fields: [
      f("order_id", "Order ID", "id", "required", "The order that was returned.",
        ["order id", "order", "order number", "id pedido", "pedido", "numero pedido", "order ref", "returned order"]),
      f("return_date", "Return date", "date", "core", "When the return was registered.",
        ["return date", "returned", "returned at", "fecha devolucion", "fecha de devolucion", "refund date", "refunded at", "date", "fecha"]),
      f("reason", "Reason", "text", "extra", "Why it was returned. Kept for reference.",
        ["reason", "motivo", "return reason", "razon", "causa", "comment", "comentario", "notes"]),
    ],
  },
];

export const TABLE: Record<TableId, Table> = Object.fromEntries(TABLES.map((t) => [t.id, t])) as Record<TableId, Table>;
export const fieldOf = (table: TableId, field: string): Field | undefined => TABLE[table].fields.find((x) => x.id === field);

/** Fields that link one table to another: [child table, child field, parent table, parent field]. */
export const RELATIONS: [TableId, string, TableId, string][] = [
  ["orders", "customer_id", "customers", "customer_id"],
  ["orders", "product_id", "products", "product_id"],
  ["delivery", "order_id", "orders", "order_id"],
  ["returns", "order_id", "orders", "order_id"],
  ["marketing", "channel", "customers", "acquisition_channel"],
];
