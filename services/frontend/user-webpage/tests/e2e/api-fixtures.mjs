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
  "seller_sku_id",
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
    fee_base: "false",
    source_document_id: "document-1",
    source_line_number: String(index),
    created_at: "2026-09-17T01:00:00Z",
  };
}

export function assignmentId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function skuAssignment(index) {
  return {
    id: assignmentId(index),
    seller_namespace: "synthetic-seller",
    sku: `GROUP-${String(index).padStart(3, "0")}`,
    company_id: "company-member-a",
    terms_version_id: `terms-${index}`,
  };
}

export function feeRow(index, sellerSkuId = assignmentId(1)) {
  return {
    seller_sku_id: sellerSkuId,
    company_id: "company-member-a",
    terms_version_id: "terms-1",
    marketplace_name: index < 2 ? "Amazon.com" : "Amazon.co.uk",
    fee_period_id: `fee-${index}`,
    valid_period: `[2026-01-${String(index + 1).padStart(2, "0")},2026-01-${String(index + 2).padStart(2, "0")})`,
    fee_rate_percent: index === 25 ? "5.123456" : "4.8",
  };
}
