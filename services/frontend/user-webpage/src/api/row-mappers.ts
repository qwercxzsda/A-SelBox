import type { CsvRecord } from "./csv.ts";
import type {
  AccountLevelTransaction,
  CanonicalRow,
  DatasetKey,
  DatasetRowMap,
  ExcludedMovement,
  PerUnitBreakdown,
  SkuEconomicsTransaction,
} from "./types.ts";
import { isJsonObject, requiredJsonString } from "./validation.ts";

function requiredCsvCell(record: CsvRecord, column: string): string {
  if (!(column in record) || record[column] === null) {
    throw new Error(`CSV response is missing required column ${column}`);
  }
  return record[column];
}

function nullableCsvCell(record: CsvRecord, column: string): string | null {
  if (!(column in record)) {
    throw new Error(`CSV response is missing column ${column}`);
  }
  return record[column];
}

function parsePerUnitBreakdown(value: string): PerUnitBreakdown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("CSV response has invalid per_unit_breakdown JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("CSV response has non-array per_unit_breakdown JSON");
  }

  return parsed.map((item) => {
    if (!isJsonObject(item)) {
      throw new Error("CSV response has an invalid per-unit entry");
    }
    return {
      category_code: requiredJsonString(item, "category_code"),
      occurrence_count: requiredJsonString(item, "occurrence_count"),
      unit_amount: requiredJsonString(item, "unit_amount"),
      currency: requiredJsonString(item, "currency"),
      source_system: requiredJsonString(item, "source_system"),
    };
  });
}

function mapSkuRow(record: CsvRecord): SkuEconomicsTransaction {
  return {
    id: requiredCsvCell(record, "id"),
    settlement_report_id: requiredCsvCell(record, "settlement_report_id"),
    elaboration_run_id: requiredCsvCell(record, "elaboration_run_id"),
    order_id: nullableCsvCell(record, "order_id"),
    adjustment_id: nullableCsvCell(record, "adjustment_id"),
    shipment_id: nullableCsvCell(record, "shipment_id"),
    posted_date: requiredCsvCell(record, "posted_date"),
    currency: requiredCsvCell(record, "currency"),
    company_id: requiredCsvCell(record, "company_id"),
    sku_company_assignment_id: requiredCsvCell(record, "sku_company_assignment_id"),
    company_fee_rule_id: nullableCsvCell(record, "company_fee_rule_id"),
    marketplace_id: requiredCsvCell(record, "marketplace_id"),
    marketplace_name: nullableCsvCell(record, "marketplace_name"),
    amz_sku: requiredCsvCell(record, "amz_sku"),
    settlement_category: requiredCsvCell(record, "settlement_category"),
    handling_method: requiredCsvCell(record, "handling_method"),
    join_method: requiredCsvCell(record, "join_method"),
    allocation_basis: requiredCsvCell(record, "allocation_basis"),
    allocation_driver: nullableCsvCell(record, "allocation_driver"),
    allocation_driver_unit: nullableCsvCell(record, "allocation_driver_unit"),
    elaborated_amount: requiredCsvCell(record, "elaborated_amount"),
    difference_amount: requiredCsvCell(record, "difference_amount"),
    settlement_amount: requiredCsvCell(record, "settlement_amount"),
    fee_rate_percent: nullableCsvCell(record, "fee_rate_percent"),
    selbox_fee: requiredCsvCell(record, "selbox_fee"),
    company_payable: requiredCsvCell(record, "company_payable"),
    created_at: requiredCsvCell(record, "created_at"),
    units_sold: nullableCsvCell(record, "units_sold"),
    units_returned: nullableCsvCell(record, "units_returned"),
    net_units_sold: nullableCsvCell(record, "net_units_sold"),
    average_sales_price: nullableCsvCell(record, "average_sales_price"),
    per_unit_breakdown: parsePerUnitBreakdown(requiredCsvCell(record, "per_unit_breakdown")),
    sales_occurrence_count: nullableCsvCell(record, "sales_occurrence_count"),
    return_occurrence_count: nullableCsvCell(record, "return_occurrence_count"),
    product_sales: requiredCsvCell(record, "product_sales"),
    product_refunds: requiredCsvCell(record, "product_refunds"),
    liquidations_proceeds: requiredCsvCell(record, "liquidations_proceeds"),
    shipping_credits: requiredCsvCell(record, "shipping_credits"),
    shipping_refunds: requiredCsvCell(record, "shipping_refunds"),
    gift_wrap_credits: requiredCsvCell(record, "gift_wrap_credits"),
    gift_wrap_refunds: requiredCsvCell(record, "gift_wrap_refunds"),
    promotional_rebates: requiredCsvCell(record, "promotional_rebates"),
    sales_tax: requiredCsvCell(record, "sales_tax"),
    marketplace_withheld_tax: requiredCsvCell(record, "marketplace_withheld_tax"),
    referral_fees: requiredCsvCell(record, "referral_fees"),
    fba_fulfillment_fees: requiredCsvCell(record, "fba_fulfillment_fees"),
    base_fulfillment_fees: requiredCsvCell(record, "base_fulfillment_fees"),
    low_inventory_level_fees: requiredCsvCell(record, "low_inventory_level_fees"),
    per_item_selling_fees: requiredCsvCell(record, "per_item_selling_fees"),
    closing_fees: requiredCsvCell(record, "closing_fees"),
    fba_prep_fees: requiredCsvCell(record, "fba_prep_fees"),
    digital_services_fees: requiredCsvCell(record, "digital_services_fees"),
    amazon_fee_taxes: requiredCsvCell(record, "amazon_fee_taxes"),
    liquidations_brokerage_fees: requiredCsvCell(record, "liquidations_brokerage_fees"),
    refund_administration_fees: requiredCsvCell(record, "refund_administration_fees"),
    shipping_chargebacks: requiredCsvCell(record, "shipping_chargebacks"),
    other_amazon_fees: requiredCsvCell(record, "other_amazon_fees"),
    advertising_cost: requiredCsvCell(record, "advertising_cost"),
    sponsored_products_charges: requiredCsvCell(record, "sponsored_products_charges"),
    sponsored_brands_charges: requiredCsvCell(record, "sponsored_brands_charges"),
    sponsored_display_charges: requiredCsvCell(record, "sponsored_display_charges"),
    advertising_refund: requiredCsvCell(record, "advertising_refund"),
    fba_storage_fees: requiredCsvCell(record, "fba_storage_fees"),
    fba_aged_inventory_fees: requiredCsvCell(record, "fba_aged_inventory_fees"),
    fba_inbound_placement_fees: requiredCsvCell(record, "fba_inbound_placement_fees"),
    inbound_transportation_fees: requiredCsvCell(record, "inbound_transportation_fees"),
    removal_disposal_fees: requiredCsvCell(record, "removal_disposal_fees"),
    removal_fees: requiredCsvCell(record, "removal_fees"),
    disposal_fees: requiredCsvCell(record, "disposal_fees"),
    inventory_reimbursements: requiredCsvCell(record, "inventory_reimbursements"),
    unmapped_amount: requiredCsvCell(record, "unmapped_amount"),
    cost_of_goods_sold: requiredCsvCell(record, "cost_of_goods_sold"),
    shipping_to_amazon_cost: requiredCsvCell(record, "shipping_to_amazon_cost"),
    mfn_fulfillment_cost: requiredCsvCell(record, "mfn_fulfillment_cost"),
    mfn_storage_cost: requiredCsvCell(record, "mfn_storage_cost"),
    miscellaneous_cost: requiredCsvCell(record, "miscellaneous_cost"),
    other_elaborated_amount: requiredCsvCell(record, "other_elaborated_amount"),
  };
}

function mapAccountRow(record: CsvRecord): AccountLevelTransaction {
  return {
    id: requiredCsvCell(record, "id"),
    settlement_report_id: requiredCsvCell(record, "settlement_report_id"),
    elaboration_run_id: requiredCsvCell(record, "elaboration_run_id"),
    order_id: nullableCsvCell(record, "order_id"),
    adjustment_id: nullableCsvCell(record, "adjustment_id"),
    shipment_id: nullableCsvCell(record, "shipment_id"),
    posted_date: requiredCsvCell(record, "posted_date"),
    currency: requiredCsvCell(record, "currency"),
    company_id: nullableCsvCell(record, "company_id"),
    marketplace_id: nullableCsvCell(record, "marketplace_id"),
    marketplace_name: nullableCsvCell(record, "marketplace_name"),
    amz_sku: nullableCsvCell(record, "amz_sku"),
    category_code: requiredCsvCell(record, "category_code"),
    pnl_treatment: requiredCsvCell(record, "pnl_treatment"),
    handling_method: requiredCsvCell(record, "handling_method"),
    join_method: requiredCsvCell(record, "join_method"),
    allocation_basis: requiredCsvCell(record, "allocation_basis"),
    allocation_driver: nullableCsvCell(record, "allocation_driver"),
    allocation_driver_unit: nullableCsvCell(record, "allocation_driver_unit"),
    unassigned_reason: nullableCsvCell(record, "unassigned_reason"),
    elaborated_amount: requiredCsvCell(record, "elaborated_amount"),
    difference_amount: requiredCsvCell(record, "difference_amount"),
    settlement_amount: requiredCsvCell(record, "settlement_amount"),
    selbox_fee: requiredCsvCell(record, "selbox_fee"),
    company_payable: requiredCsvCell(record, "company_payable"),
    created_at: requiredCsvCell(record, "created_at"),
  };
}

function mapExcludedRow(record: CsvRecord): ExcludedMovement {
  return {
    id: requiredCsvCell(record, "id"),
    settlement_report_id: requiredCsvCell(record, "settlement_report_id"),
    elaboration_run_id: requiredCsvCell(record, "elaboration_run_id"),
    adjustment_id: nullableCsvCell(record, "adjustment_id"),
    shipment_id: nullableCsvCell(record, "shipment_id"),
    posted_date: requiredCsvCell(record, "posted_date"),
    currency: requiredCsvCell(record, "currency"),
    category_code: requiredCsvCell(record, "category_code"),
    handling_method: requiredCsvCell(record, "handling_method"),
    allocation_basis: requiredCsvCell(record, "allocation_basis"),
    unassigned_reason: nullableCsvCell(record, "unassigned_reason"),
    settlement_amount: requiredCsvCell(record, "settlement_amount"),
    difference_amount: requiredCsvCell(record, "difference_amount"),
    created_at: requiredCsvCell(record, "created_at"),
  };
}

export function mapDatasetRows<Dataset extends DatasetKey>(
  dataset: Dataset,
  records: CsvRecord[],
): DatasetRowMap[Dataset][] {
  let rows: CanonicalRow[];
  switch (dataset) {
    case "sku":
      rows = records.map(mapSkuRow);
      break;
    case "account":
      rows = records.map(mapAccountRow);
      break;
    case "excluded":
      rows = records.map(mapExcludedRow);
      break;
  }
  return rows as DatasetRowMap[Dataset][];
}
