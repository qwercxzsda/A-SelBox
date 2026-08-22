import assert from "node:assert/strict";
import test from "node:test";
import {
  BREAKDOWN_CATEGORIES,
  CATEGORY_CATALOG,
  CONTRIBUTION_CATEGORIES,
  categoryLabel,
} from "../src/categories.ts";

const EXPECTED_CATALOG = [
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
];

test("category catalog matches the canonical database display contract", () => {
  assert.deepEqual(CATEGORY_CATALOG, EXPECTED_CATALOG);
  assert.deepEqual(
    CATEGORY_CATALOG.map(([, , displayOrder]) => displayOrder),
    [...CATEGORY_CATALOG]
      .map(([, , displayOrder]) => displayOrder)
      .sort((left, right) => left - right),
  );
});

test("rendered category groups use canonical labels and deliberate pseudo-categories", () => {
  const knownDefinitions = [...CONTRIBUTION_CATEGORIES, ...BREAKDOWN_CATEGORIES].filter(
    ([, code]) => code !== "OTHER_ELABORATED_AMOUNT",
  );
  for (const [, code, label] of knownDefinitions) {
    assert.equal(label, categoryLabel(code));
  }
  assert.deepEqual(CONTRIBUTION_CATEGORIES.at(-1), [
    "other_elaborated_amount",
    "OTHER_ELABORATED_AMOUNT",
    "Other elaborated amount",
  ]);
});
