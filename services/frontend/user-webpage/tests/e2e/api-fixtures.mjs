export const SETTLEMENT_COLUMNS = [
  "id",
  "version_id",
  "settlement_id",
  "preprocess_version",
  "seller_namespace",
  "source_line_number",
  "category",
  "family",
  "component_type",
  "accounting_subtype",
  "sku",
  "marketplace_name",
  "amount",
  "currency",
  "quantity",
  "posted_date",
  "posted_at",
  "transaction_type",
  "amount_type",
  "amount_description",
  "created_at",
];

export const DATA_KIOSK_COLUMNS = [
  "id",
  "version_id",
  "day_id",
  "preprocess_version",
  "seller_namespace",
  "marketplace_name",
  "activity_date",
  "component_key",
  "sku",
  "category",
  "component_type",
  "amount",
  "currency",
  "quantity",
  "fee_base",
  "source_document_id",
  "source_line_number",
  "created_at",
];

export const FEE_COLUMNS = [
  "sku_id",
  "company_id",
  "terms_version_id",
  "marketplace_name",
  "fee_period_id",
  "valid_period",
  "fee_rate_percent",
];

export function csv(columns, rows) {
  const quote = (value) =>
    value === null || value === undefined ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => quote(row[key])).join(",")),
  ].join("\n");
}

export function kioskRow(index, amount) {
  return {
    id: `kiosk-${index}`,
    version_id: "version-1",
    day_id: "day-1",
    preprocess_version: "v0",
    seller_namespace: "synthetic-seller",
    marketplace_name: "Amazon.com",
    activity_date: "2026-09-16",
    component_key: `component-${index}`,
    sku: `KIOSK-${index}`,
    category: "DATA_KIOSK",
    component_type: "FULFILLMENT",
    amount,
    currency: "USD",
    quantity: "1",
    fee_base: null,
    source_document_id: "document-1",
    source_line_number: String(index),
    created_at: "2026-09-17T01:00:00Z",
  };
}

export function settlementRow(index, amount = "10") {
  return {
    id: `settlement-${index}`,
    version_id: "version-1",
    settlement_id: "settlement-1",
    preprocess_version: "v0",
    seller_namespace: "synthetic-seller",
    source_line_number: "1",
    category: "SETTLEMENT",
    family: "Order",
    component_type: "Principal",
    accounting_subtype: "Principal",
    sku: `SETTLEMENT-${index}`,
    marketplace_name: "Amazon.com",
    amount,
    currency: "USD",
    quantity: "1",
    posted_date: "2026-09-01",
    posted_at: "2026-09-01T00:00:00Z",
    transaction_type: "Order",
    amount_type: "ItemPrice",
    amount_description: "Principal",
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
  "sku",
  "component_type",
  "currency",
  "source_amount",
  "quantity",
  "fee_base",
  "category",
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
    source: "SETTLEMENT",
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
    category: "SETTLEMENT",
    company_id: companyId,
    fee_rate_percent: "5",
    resolution_status: "APPLIED",
    fee_amount: "0.05",
    company_amount: "0.95",
  };
}
