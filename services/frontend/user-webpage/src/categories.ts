export type CategoryDefinition = readonly [key: string, code: string, label: string];
export type CategoryCatalogEntry = readonly [code: string, label: string, displayOrder: number];

// Mirrors private.settlement_categories in display_order. The public read
// models expose codes but not the private display catalog, so the client keeps
// this complete reviewed projection until the API publishes catalog metadata.
export const CATEGORY_CATALOG = [
  ["ORDER_NET", "Order settlement total", 5],
  ["PRODUCT_SALES", "Product sales", 10],
  ["PRODUCT_REFUNDS", "Product refunds", 20],
  ["LIQUIDATIONS_PROCEEDS", "Liquidations proceeds", 25],
  ["SHIPPING_CREDITS", "Shipping credits", 30],
  ["SHIPPING_REFUNDS", "Shipping refunds", 40],
  ["GIFT_WRAP_CREDITS", "Gift wrap credits", 50],
  ["GIFT_WRAP_REFUNDS", "Gift wrap refunds", 60],
  ["PROMOTIONAL_REBATES", "Promotional rebates", 70],
  ["SALES_TAX", "Sales tax", 80],
  ["MARKETPLACE_WITHHELD_TAX", "Marketplace withheld tax", 90],
  ["REFERRAL_FEES", "Referral fees", 100],
  ["FBA_FULFILLMENT_FEES", "FBA fulfillment fees", 110],
  ["BASE_FULFILLMENT_FEES", "Base fulfillment fees", 111],
  ["LOW_INVENTORY_LEVEL_FEES", "Low inventory level fees", 112],
  ["PER_ITEM_SELLING_FEES", "Per-item selling fees", 113],
  ["CLOSING_FEES", "Closing fees", 114],
  ["FBA_PREP_FEES", "FBA prep fees", 115],
  ["DIGITAL_SERVICES_FEES", "Digital services fees", 116],
  ["AMAZON_FEE_TAXES", "Taxes on Amazon fees", 117],
  ["LIQUIDATIONS_BROKERAGE_FEES", "Liquidations brokerage fees", 118],
  ["REFUND_ADMINISTRATION_FEES", "Refund administration fees", 120],
  ["SHIPPING_CHARGEBACKS", "Shipping chargebacks", 125],
  ["OTHER_AMAZON_FEES", "Other Amazon fees", 126],
  ["ADVERTISING_COST", "Cost of advertising", 130],
  ["SPONSORED_PRODUCTS_CHARGES", "Sponsored Products charges", 131],
  ["SPONSORED_BRANDS_CHARGES", "Sponsored Brands charges", 132],
  ["SPONSORED_DISPLAY_CHARGES", "Sponsored Display charges", 133],
  ["ADVERTISING_REFUND", "Refund for advertiser", 140],
  ["FBA_STORAGE_FEES", "Monthly inventory storage fees", 150],
  ["FBA_AGED_INVENTORY_FEES", "FBA aged inventory surcharge", 160],
  ["FBA_INBOUND_PLACEMENT_FEES", "FBA inbound placement service fees", 170],
  ["INBOUND_TRANSPORTATION_FEES", "Inbound transportation fees", 180],
  ["REMOVAL_DISPOSAL_FEES", "Removal and disposal fees", 190],
  ["REMOVAL_FEES", "FBA removal order fees", 191],
  ["DISPOSAL_FEES", "FBA disposal order fees", 192],
  ["INVENTORY_REIMBURSEMENTS", "Inventory reimbursements", 200],
  ["SUBSCRIPTION_FEES", "Subscription fees", 210],
  ["PAYMENT_MOVEMENT", "Settlement and payment movement", 220],
  ["UNMAPPED", "Unmapped settlement amount", 230],
  ["COST_OF_GOODS_SOLD", "Cost of goods sold", 240],
  ["SHIPPING_TO_AMAZON_COST", "Shipping to Amazon cost", 250],
  ["MFN_FULFILLMENT_COST", "MFN fulfillment cost", 260],
  ["MFN_STORAGE_COST", "MFN storage cost", 270],
  ["MISCELLANEOUS_COST", "Miscellaneous cost", 280],
] as const satisfies readonly CategoryCatalogEntry[];

const CATEGORY_LABELS = new Map<string, string>(
  CATEGORY_CATALOG.map(([code, label]) => [code, label]),
);

function categoryDefinition(key: string, code: string): CategoryDefinition {
  const label = CATEGORY_LABELS.get(code);
  if (label === undefined) {
    throw new Error(`Category ${code} is missing from the display catalog`);
  }
  return [key, code, label];
}

export const CONTRIBUTION_CATEGORIES: readonly CategoryDefinition[] = [
  categoryDefinition("product_sales", "PRODUCT_SALES"),
  categoryDefinition("product_refunds", "PRODUCT_REFUNDS"),
  categoryDefinition("liquidations_proceeds", "LIQUIDATIONS_PROCEEDS"),
  categoryDefinition("shipping_credits", "SHIPPING_CREDITS"),
  categoryDefinition("shipping_refunds", "SHIPPING_REFUNDS"),
  categoryDefinition("gift_wrap_credits", "GIFT_WRAP_CREDITS"),
  categoryDefinition("gift_wrap_refunds", "GIFT_WRAP_REFUNDS"),
  categoryDefinition("promotional_rebates", "PROMOTIONAL_REBATES"),
  categoryDefinition("sales_tax", "SALES_TAX"),
  categoryDefinition("marketplace_withheld_tax", "MARKETPLACE_WITHHELD_TAX"),
  categoryDefinition("referral_fees", "REFERRAL_FEES"),
  categoryDefinition("fba_fulfillment_fees", "FBA_FULFILLMENT_FEES"),
  categoryDefinition("base_fulfillment_fees", "BASE_FULFILLMENT_FEES"),
  categoryDefinition("low_inventory_level_fees", "LOW_INVENTORY_LEVEL_FEES"),
  categoryDefinition("per_item_selling_fees", "PER_ITEM_SELLING_FEES"),
  categoryDefinition("closing_fees", "CLOSING_FEES"),
  categoryDefinition("fba_prep_fees", "FBA_PREP_FEES"),
  categoryDefinition("digital_services_fees", "DIGITAL_SERVICES_FEES"),
  categoryDefinition("amazon_fee_taxes", "AMAZON_FEE_TAXES"),
  categoryDefinition("liquidations_brokerage_fees", "LIQUIDATIONS_BROKERAGE_FEES"),
  categoryDefinition("refund_administration_fees", "REFUND_ADMINISTRATION_FEES"),
  categoryDefinition("shipping_chargebacks", "SHIPPING_CHARGEBACKS"),
  categoryDefinition("other_amazon_fees", "OTHER_AMAZON_FEES"),
  categoryDefinition("advertising_cost", "ADVERTISING_COST"),
  categoryDefinition("sponsored_products_charges", "SPONSORED_PRODUCTS_CHARGES"),
  categoryDefinition("sponsored_brands_charges", "SPONSORED_BRANDS_CHARGES"),
  categoryDefinition("sponsored_display_charges", "SPONSORED_DISPLAY_CHARGES"),
  categoryDefinition("advertising_refund", "ADVERTISING_REFUND"),
  categoryDefinition("fba_storage_fees", "FBA_STORAGE_FEES"),
  categoryDefinition("fba_aged_inventory_fees", "FBA_AGED_INVENTORY_FEES"),
  categoryDefinition("fba_inbound_placement_fees", "FBA_INBOUND_PLACEMENT_FEES"),
  categoryDefinition("inbound_transportation_fees", "INBOUND_TRANSPORTATION_FEES"),
  categoryDefinition("removal_disposal_fees", "REMOVAL_DISPOSAL_FEES"),
  categoryDefinition("removal_fees", "REMOVAL_FEES"),
  categoryDefinition("disposal_fees", "DISPOSAL_FEES"),
  categoryDefinition("inventory_reimbursements", "INVENTORY_REIMBURSEMENTS"),
  categoryDefinition("unmapped_amount", "UNMAPPED"),
  ["other_elaborated_amount", "OTHER_ELABORATED_AMOUNT", "Other elaborated amount"],
];

export const BREAKDOWN_CATEGORIES: readonly CategoryDefinition[] = [
  categoryDefinition("cost_of_goods_sold", "COST_OF_GOODS_SOLD"),
  categoryDefinition("shipping_to_amazon_cost", "SHIPPING_TO_AMAZON_COST"),
  categoryDefinition("mfn_fulfillment_cost", "MFN_FULFILLMENT_COST"),
  categoryDefinition("mfn_storage_cost", "MFN_STORAGE_COST"),
  categoryDefinition("miscellaneous_cost", "MISCELLANEOUS_COST"),
];

export function humanizeCode(value: string | null): string {
  if (!value) {
    return "—";
  }

  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

export function categoryLabel(code: string | null): string {
  return code ? (CATEGORY_LABELS.get(code) ?? humanizeCode(code)) : "—";
}
