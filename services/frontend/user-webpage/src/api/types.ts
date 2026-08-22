export type DatasetKey = "sku" | "account" | "excluded";
export type SortDirection = "asc" | "desc";
export type DecimalString = string;

export interface SessionUser {
  id: string;
  email?: string;
}

export interface Session {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  refresh_token: string;
  user: SessionUser;
}

export interface Company {
  id: string;
  company_name: string;
}

export interface PerUnitBreakdown {
  category_code: string;
  occurrence_count: DecimalString;
  unit_amount: DecimalString;
  currency: string;
  source_system: string;
}

export interface SkuEconomicsTransaction {
  id: string;
  settlement_report_id: string;
  elaboration_run_id: string;
  order_id: string | null;
  adjustment_id: string | null;
  shipment_id: string | null;
  posted_date: string;
  currency: string;
  company_id: string;
  sku_company_assignment_id: string;
  company_fee_rule_id: string | null;
  marketplace_id: string;
  marketplace_name: string | null;
  amz_sku: string;
  settlement_category: string;
  handling_method: string;
  join_method: string;
  allocation_basis: string;
  allocation_driver: DecimalString | null;
  allocation_driver_unit: string | null;
  elaborated_amount: DecimalString;
  difference_amount: DecimalString;
  settlement_amount: DecimalString;
  fee_rate_percent: DecimalString | null;
  selbox_fee: DecimalString;
  company_payable: DecimalString;
  created_at: string;
  units_sold: DecimalString | null;
  units_returned: DecimalString | null;
  net_units_sold: DecimalString | null;
  average_sales_price: DecimalString | null;
  per_unit_breakdown: PerUnitBreakdown[];
  sales_occurrence_count: DecimalString | null;
  return_occurrence_count: DecimalString | null;
  product_sales: DecimalString;
  product_refunds: DecimalString;
  liquidations_proceeds: DecimalString;
  shipping_credits: DecimalString;
  shipping_refunds: DecimalString;
  gift_wrap_credits: DecimalString;
  gift_wrap_refunds: DecimalString;
  promotional_rebates: DecimalString;
  sales_tax: DecimalString;
  marketplace_withheld_tax: DecimalString;
  referral_fees: DecimalString;
  fba_fulfillment_fees: DecimalString;
  base_fulfillment_fees: DecimalString;
  low_inventory_level_fees: DecimalString;
  per_item_selling_fees: DecimalString;
  closing_fees: DecimalString;
  fba_prep_fees: DecimalString;
  digital_services_fees: DecimalString;
  amazon_fee_taxes: DecimalString;
  liquidations_brokerage_fees: DecimalString;
  refund_administration_fees: DecimalString;
  shipping_chargebacks: DecimalString;
  other_amazon_fees: DecimalString;
  advertising_cost: DecimalString;
  sponsored_products_charges: DecimalString;
  sponsored_brands_charges: DecimalString;
  sponsored_display_charges: DecimalString;
  advertising_refund: DecimalString;
  fba_storage_fees: DecimalString;
  fba_aged_inventory_fees: DecimalString;
  fba_inbound_placement_fees: DecimalString;
  inbound_transportation_fees: DecimalString;
  removal_disposal_fees: DecimalString;
  removal_fees: DecimalString;
  disposal_fees: DecimalString;
  inventory_reimbursements: DecimalString;
  unmapped_amount: DecimalString;
  cost_of_goods_sold: DecimalString;
  shipping_to_amazon_cost: DecimalString;
  mfn_fulfillment_cost: DecimalString;
  mfn_storage_cost: DecimalString;
  miscellaneous_cost: DecimalString;
  other_elaborated_amount: DecimalString;
}

export interface AccountLevelTransaction {
  id: string;
  settlement_report_id: string;
  elaboration_run_id: string;
  order_id: string | null;
  adjustment_id: string | null;
  shipment_id: string | null;
  posted_date: string;
  currency: string;
  company_id: string | null;
  marketplace_id: string | null;
  marketplace_name: string | null;
  amz_sku: string | null;
  category_code: string;
  pnl_treatment: string;
  handling_method: string;
  join_method: string;
  allocation_basis: string;
  allocation_driver: DecimalString | null;
  allocation_driver_unit: string | null;
  unassigned_reason: string | null;
  elaborated_amount: DecimalString;
  difference_amount: DecimalString;
  settlement_amount: DecimalString;
  selbox_fee: DecimalString;
  company_payable: DecimalString;
  created_at: string;
}

export interface ExcludedMovement {
  id: string;
  settlement_report_id: string;
  elaboration_run_id: string;
  adjustment_id: string | null;
  shipment_id: string | null;
  posted_date: string;
  currency: string;
  category_code: string;
  handling_method: string;
  allocation_basis: string;
  unassigned_reason: string | null;
  settlement_amount: DecimalString;
  difference_amount: DecimalString;
  created_at: string;
}

export type CanonicalRow = SkuEconomicsTransaction | AccountLevelTransaction | ExcludedMovement;

export interface PageResult<Row extends CanonicalRow = CanonicalRow> {
  rows: Row[];
  totalCount: number | null;
}

export interface DatasetRowMap {
  sku: SkuEconomicsTransaction;
  account: AccountLevelTransaction;
  excluded: ExcludedMovement;
}

export interface DatasetSort {
  column: string;
  direction: SortDirection;
}

export interface FetchDatasetPageOptions<Dataset extends DatasetKey = DatasetKey> {
  accessToken: string;
  dataset: Dataset;
  pageIndex: number;
  pageSize: number;
  search: string;
  sort: DatasetSort;
}
