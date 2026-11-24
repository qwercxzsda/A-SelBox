export const FINANCES_COLUMNS = [
  "id",
  "version_id",
  "preprocess_version",
  "batch_id",
  "is_current",
  "seller_namespace",
  "transaction_id",
  "native_transaction_id",
  "deferred_transaction_id",
  "release_transaction_id",
  "source_page_number",
  "source_record_number",
  "component_number",
  "route",
  "selbox_group",
  "component_type",
  "amount_part",
  "order_id",
  "reference_id",
  "reference_month",
  "ledger_start_month",
  "ledger_end_month",
  "fnsku",
  "asin",
  "sku",
  "marketplace_name",
  "amount",
  "currency",
  "quantity",
  "fee_base",
  "posted_date",
  "posted_at",
  "activity_at",
  "transaction_type",
  "transaction_status",
  "account_type",
  "activity_eligible",
  "breakdown_path",
  "created_at",
];

export function csv(columns, rows) {
  const quote = (value) =>
    value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => quote(row[key])).join(",")),
  ].join("\n");
}

export function financesRow(index, amount = "10") {
  return {
    id: `finances-${index}`,
    version_id: "version-1",
    batch_id: "finances-batch-1",
    is_current: "true",
    transaction_id: `transaction-${index}`,
    native_transaction_id: `amazon-transaction-${index}`,
    deferred_transaction_id: null,
    release_transaction_id: null,
    component_number: String(index),
    preprocess_version: "v0",
    seller_namespace: "synthetic-seller",
    source_page_number: "1",
    source_record_number: "1",
    route: "SKU",
    selbox_group: null,
    component_type: "PRODUCT_SALES",
    amount_part: "BASE",
    order_id: null,
    reference_id: null,
    reference_month: null,
    ledger_start_month: null,
    ledger_end_month: null,
    fnsku: null,
    asin: null,
    sku: `FINANCES-${index}`,
    marketplace_name: "Amazon.com",
    amount,
    currency: "USD",
    quantity: "1",
    posted_date: "2026-09-01",
    posted_at: "2026-09-01T00:00:00Z",
    transaction_type: "Shipment",
    transaction_status: "DEFERRED",
    account_type: "STANDARD_ORDERS",
    activity_eligible: "true",
    breakdown_path: '["ProductCharges","OurPricePrincipal"]',
    fee_base: amount,
    created_at: "2026-09-02T00:00:00Z",
  };
}

export function assignmentId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function skuAssignment(index) {
  return {
    id: assignmentId(index),
    sku: `GROUP-${String(index).padStart(3, "0")}`,
    company_id: "company-member-a",
    terms_version_id: `terms-${index}`,
  };
}

export function skuAssignments(skus, companyId = "company-member-a") {
  return [...new Set(skus)].map((sku, index) => ({
    ...skuAssignment(index + 1),
    sku,
    company_id: companyId,
  }));
}

export function feeRow(index, skuId = assignmentId(1)) {
  return {
    sku_id: skuId,
    company_id: "company-member-a",
    terms_version_id: "terms-1",
    marketplace_name: index < 2 ? "Amazon.com" : "Amazon.co.uk",
    fee_period_id: `fee-${index}`,
    valid_period: `[2026-01-${String(index + 1).padStart(2, "0")},2026-01-${String(index + 2).padStart(2, "0")})`,
    fee_rate_percent: index === 25 ? "5.123456" : "4.8",
  };
}

export const LIVE_COLUMNS = [
  "source",
  "source_row_id",
  "source_version_id",
  "preprocess_version",
  "source_identity_id",
  "seller_namespace",
  "marketplace_name",
  "activity_date",
  "activity_at",
  "sku",
  "component_type",
  "currency",
  "base_amount",
  "tax_amount",
  "source_amount",
  "quantity",
  "fee_base",
  "outcome",
  "selbox_group",
  "sku_id",
  "terms_version_id",
  "company_id",
  "fee_period_id",
  "fee_rate_percent",
  "resolution_status",
  "fee_amount",
  "company_amount",
];

export function liveRow(prefix, index, companyId = "company-member-a") {
  return {
    source: "FINANCES",
    source_row_id: `${prefix}-${index}`,
    source_version_id: "version-1",
    preprocess_version: "v0",
    seller_namespace: "synthetic-seller",
    marketplace_name: "Amazon.com",
    activity_date: "2026-09-01",
    sku: `${prefix}-${String(index).padStart(3, "0")}`,
    component_type: "PRINCIPAL",
    currency: "USD",
    source_amount: `${index}.123456789012345678`,
    quantity: "1",
    fee_base: `${index}.123456789012345678`,
    outcome: "COMPANY",
    selbox_group: null,
    company_id: companyId,
    fee_rate_percent: "5",
    resolution_status: "APPLIED",
    fee_amount: "0.05",
    company_amount: "0.95",
  };
}
