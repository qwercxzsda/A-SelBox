import type { ReactNode } from "react";
import type {
  AccountLevelTransaction,
  CanonicalRow,
  DatasetKey,
  ExcludedMovement,
  SkuEconomicsTransaction,
} from "./api";
import {
  BREAKDOWN_CATEGORIES,
  CONTRIBUTION_CATEGORIES,
  categoryLabel,
  type CategoryDefinition,
} from "./categories";
import {
  formatExactDecimal,
  formatExactMoney,
  formatExactQuantity,
  isNonZeroDecimal,
} from "./decimal";
import { DATASET_PRESENTATION, companyLabel, formatDate, rowText } from "./view-model";
import { CodeLabel } from "./Cell";

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-field">
      <span className="field-label">{label}</span>
      <div className="field-value">{value}</div>
    </div>
  );
}

function AmountCard({
  className,
  currency,
  label,
  value,
}: {
  className?: string;
  currency: string | null;
  label: string;
  value: string | null;
}) {
  return (
    <div className={`amount-card${className ? ` ${className}` : ""}`}>
      <span className="amount-label">{label}</span>
      <strong>{formatExactMoney(value, currency)}</strong>
    </div>
  );
}

function CategoryGrid({
  categories,
  currency,
  row,
}: {
  categories: readonly CategoryDefinition[];
  currency: string | null;
  row: SkuEconomicsTransaction;
}) {
  const visibleCategories = categories.filter(([key]) => isNonZeroDecimal(rowText(row, key)));
  if (visibleCategories.length === 0) {
    return <p className="empty-detail">No nonzero values in this category group.</p>;
  }

  return (
    <div className="category-grid">
      {visibleCategories.map(([key, code, label]) => (
        <div className="category-row" key={key}>
          <span className="category-name">
            {label}
            <code>{code}</code>
          </span>
          <strong>{formatExactMoney(rowText(row, key), currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function AuditDetails({ row }: { row: CanonicalRow }) {
  const fields = [
    ["Target ID", "id"],
    ["Settlement report", "settlement_report_id"],
    ["Elaboration run", "elaboration_run_id"],
    ["SKU assignment", "sku_company_assignment_id"],
    ["Company fee rule", "company_fee_rule_id"],
    ["Marketplace ID", "marketplace_id"],
    ["Order ID", "order_id"],
    ["Adjustment ID", "adjustment_id"],
    ["Shipment ID", "shipment_id"],
    ["Handling method", "handling_method"],
    ["Join method", "join_method"],
    ["Allocation basis", "allocation_basis"],
    ["Allocation driver", "allocation_driver"],
    ["Driver unit", "allocation_driver_unit"],
    ["Unassigned reason", "unassigned_reason"],
    ["Published target created", "created_at"],
  ] as const;

  return (
    <details className="audit-details">
      <summary>Audit and join detail</summary>
      <div className="audit-grid">
        {fields.map(([label, key]) => {
          const value = rowText(row, key);
          const isCode = key.endsWith("method") || key.endsWith("basis") || key.endsWith("reason");
          return (
            <div className="audit-value" key={key}>
              <span className="field-label">{label}</span>
              {isCode ? <CodeLabel code={value} /> : <code>{value ?? "—"}</code>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function OperationalMetrics({ row }: { row: SkuEconomicsTransaction }) {
  const currency = row.currency;
  const perUnitItems = row.per_unit_breakdown;
  return (
    <div className="detail-section">
      <div className="section-heading">
        <h3>Operational metrics</h3>
        <span>Missing values remain unknown</span>
      </div>
      <div className="metric-grid">
        <DetailField label="Units sold" value={formatExactQuantity(rowText(row, "units_sold"))} />
        <DetailField
          label="Units returned"
          value={formatExactQuantity(rowText(row, "units_returned"))}
        />
        <DetailField
          label="Net units sold"
          value={formatExactQuantity(rowText(row, "net_units_sold"))}
        />
        <DetailField
          label="Average sales price"
          value={formatExactMoney(rowText(row, "average_sales_price"), currency)}
        />
        <DetailField
          label="Sales occurrences"
          value={formatExactQuantity(rowText(row, "sales_occurrence_count"))}
        />
        <DetailField
          label="Return occurrences"
          value={formatExactQuantity(rowText(row, "return_occurrence_count"))}
        />
      </div>

      {perUnitItems.length > 0 ? (
        <div className="per-unit-table">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Source</th>
                <th className="numeric">Occurrences</th>
                <th className="numeric">Unit amount</th>
              </tr>
            </thead>
            <tbody>
              {perUnitItems.map((item, index) => (
                <tr key={`${item.category_code}-${item.unit_amount}-${String(index)}`}>
                  <td>
                    <CodeLabel category code={item.category_code} />
                  </td>
                  <td>
                    <CodeLabel code={item.source_system} />
                  </td>
                  <td className="numeric">{formatExactQuantity(item.occurrence_count)}</td>
                  <td className="numeric">{formatExactMoney(item.unit_amount, item.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function SkuDetail({ companyName, row }: { companyName: string; row: SkuEconomicsTransaction }) {
  const currency = row.currency;
  const feeRate = row.fee_rate_percent;
  return (
    <>
      <div className="detail-section">
        <div className="detail-grid">
          <DetailField label="Company" value={companyName} />
          <DetailField label="Marketplace" value={rowText(row, "marketplace_name") ?? "—"} />
          <DetailField label="SKU" value={rowText(row, "amz_sku") ?? "—"} />
          <DetailField
            label="Settlement category"
            value={<CodeLabel category code={rowText(row, "settlement_category")} />}
          />
          <DetailField
            label="Handling"
            value={<CodeLabel code={rowText(row, "handling_method")} />}
          />
          <DetailField label="Join" value={<CodeLabel code={rowText(row, "join_method")} />} />
          <DetailField label="Allocation basis" value={rowText(row, "allocation_basis") ?? "—"} />
          <DetailField
            label="Fee rate"
            value={feeRate === null ? "—" : `${formatExactDecimal(feeRate)}%`}
          />
        </div>
      </div>

      <div className="detail-section">
        <div className="section-heading">
          <h3>Settlement contributions</h3>
          <span>Catalog order · exact signed values</span>
        </div>
        <CategoryGrid categories={CONTRIBUTION_CATEGORIES} currency={currency} row={row} />
      </div>

      <div className="detail-section">
        <div className="section-heading">
          <h3>Seller-entered breakdowns</h3>
          <span>Noncontributing detail</span>
        </div>
        <CategoryGrid categories={BREAKDOWN_CATEGORIES} currency={currency} row={row} />
      </div>

      <OperationalMetrics row={row} />
    </>
  );
}

function AccountDetail({
  companyName,
  row,
}: {
  companyName: string;
  row: AccountLevelTransaction;
}) {
  return (
    <div className="detail-section">
      <div className="detail-grid">
        <DetailField label="Company" value={companyName} />
        <DetailField label="Marketplace" value={rowText(row, "marketplace_name") ?? "—"} />
        <DetailField label="SKU evidence" value={rowText(row, "amz_sku") ?? "—"} />
        <DetailField
          label="Category"
          value={<CodeLabel category code={rowText(row, "category_code")} />}
        />
        <DetailField
          label="P&L treatment"
          value={<CodeLabel code={rowText(row, "pnl_treatment")} />}
        />
        <DetailField
          label="Handling"
          value={<CodeLabel code={rowText(row, "handling_method")} />}
        />
        <DetailField label="Join" value={<CodeLabel code={rowText(row, "join_method")} />} />
        <DetailField
          label="Unassigned reason"
          value={<CodeLabel code={rowText(row, "unassigned_reason")} />}
        />
      </div>
    </div>
  );
}

function ExcludedDetail({ row }: { row: ExcludedMovement }) {
  return (
    <div className="detail-section">
      <div className="detail-grid">
        <DetailField
          label="Category"
          value={<CodeLabel category code={rowText(row, "category_code")} />}
        />
        <DetailField
          label="Handling"
          value={<CodeLabel code={rowText(row, "handling_method")} />}
        />
        <DetailField label="Adjustment" value={rowText(row, "adjustment_id") ?? "—"} />
        <DetailField label="Shipment" value={rowText(row, "shipment_id") ?? "—"} />
        <DetailField label="Allocation basis" value={rowText(row, "allocation_basis") ?? "—"} />
        <DetailField
          label="Unassigned reason"
          value={<CodeLabel code={rowText(row, "unassigned_reason")} />}
        />
      </div>
    </div>
  );
}

export function RowDetail({
  companies,
  dataset,
  row,
}: {
  companies: Map<string, string>;
  dataset: DatasetKey;
  row: CanonicalRow;
}) {
  const currency = rowText(row, "currency");
  const category = rowText(row, dataset === "sku" ? "settlement_category" : "category_code");
  const companyName = companyLabel(rowText(row, "company_id"), companies);
  const amountFields =
    dataset === "excluded"
      ? ([
          ["Difference", "difference_amount", "difference"],
          ["Settlement", "settlement_amount", ""],
        ] as const)
      : ([
          ["Elaborated", "elaborated_amount", ""],
          ["Difference", "difference_amount", "difference"],
          ["Settlement", "settlement_amount", ""],
          ["SelBox fee", "selbox_fee", ""],
          ["Company payable", "company_payable", "payable"],
        ] as const);

  return (
    <article className="detail-card">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Published allocation target</p>
          <h2>
            {dataset === "sku"
              ? (rowText(row, "amz_sku") ?? "SKU target")
              : categoryLabel(category)}
          </h2>
          <p>{DATASET_PRESENTATION[dataset].description}</p>
        </div>
      </div>

      <div className="detail-context">
        <span className="context-chip">{formatDate(rowText(row, "posted_date"))}</span>
        <span className="context-chip">{currency ?? "No currency"}</span>
        {dataset !== "excluded" ? <span className="context-chip">{companyName}</span> : null}
        {rowText(row, "order_id") ? (
          <span className="context-chip">Order {rowText(row, "order_id")}</span>
        ) : null}
      </div>

      <div className={`reconciliation-grid${dataset === "excluded" ? " compact" : ""}`}>
        {amountFields.map(([label, key, className]) => (
          <AmountCard
            className={className || undefined}
            currency={currency}
            key={key}
            label={label}
            value={rowText(row, key)}
          />
        ))}
      </div>

      {dataset === "sku" && "per_unit_breakdown" in row ? (
        <SkuDetail companyName={companyName} row={row} />
      ) : dataset === "account" && "pnl_treatment" in row ? (
        <AccountDetail companyName={companyName} row={row} />
      ) : dataset === "excluded" && !("pnl_treatment" in row) && !("per_unit_breakdown" in row) ? (
        <ExcludedDetail row={row} />
      ) : null}

      <AuditDetails row={row} />
    </article>
  );
}
