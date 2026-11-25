import type { InventoryRow } from "./api/inventory";
import { DetailSection } from "./DetailSection";
import { AdditionalDetails } from "./AdditionalDetails";
import { DetailDrawer } from "./DetailDrawer";
import { DetailFields } from "./DetailFields";
import {
  InventoryHealthLabel,
  InventoryMetrics,
  InventoryRecommendationLabel,
} from "./InventoryMetrics";
import { INVENTORY_METRICS } from "./inventory-metrics";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { InventorySourceDate } from "./InventorySourceDate";
import { formatRecordDate } from "./date-display";
import { inventoryRowId } from "./inventory-row";
import "./InventoryDetail.css";

export function InventoryDetail({
  row,
  onClose,
  onShowTransactions,
  now,
  administrator,
}: {
  row: InventoryRow | null;
  onClose: () => void;
  onShowTransactions: (sku: string) => void;
  now: number;
  administrator: boolean;
}) {
  return (
    <DetailDrawer
      id="inventory-details"
      opened={row !== null}
      onClose={onClose}
      width="wide"
      title="Inventory details"
      context={row ? `${row.sku} · ${row.marketplace_name}` : ""}
    >
      {row ? (
        <div className="inventory-detail">
          <DetailFields
            fields={[
              {
                key: "sku",
                label: "SKU",
                value: <SkuTransactionLink sku={row.sku} onShowTransactions={onShowTransactions} />,
              },
              {
                key: "stock-date",
                label: "Stock date",
                value: (
                  <InventorySourceDate
                    snapshotDate={row.snapshot_date}
                    reportCreatedAt={row.report_created_at}
                    marketplace={row.marketplace_name}
                    now={now}
                  />
                ),
              },
            ]}
          />
          <div className="inventory-detail-grid">
            <DetailSection title="Sales · last 90 days">
              <InventoryMetrics row={row} fields={INVENTORY_METRICS.sales} />
            </DetailSection>
            <DetailSection title="Recommendation">
              <InventoryRecommendationLabel action={row.recommended_action} />
              <InventoryMetrics row={row} fields={INVENTORY_METRICS.recommendation} />
            </DetailSection>
            <DetailSection title="Inventory overview">
              <InventoryMetrics row={row} fields={INVENTORY_METRICS.overview} />
            </DetailSection>
            <DetailSection title="Inventory health status">
              <InventoryHealthLabel status={row.health_status} />
              <InventoryMetrics row={row} fields={INVENTORY_METRICS.health} />
            </DetailSection>
          </div>
          <DetailSection title="Inventory breakdown">
            <InventoryMetrics
              row={row}
              fields={INVENTORY_METRICS.breakdown}
              className="inventory-detail-breakdown"
            />
          </DetailSection>
          <AdditionalDetails
            stateKey={`inventory:${inventoryRowId(row)}:metadata`}
            rows={[
              ...(administrator
                ? [
                    { field: "Capture ID", value: row.capture_id },
                    { field: "Company ID", value: row.company_id },
                  ]
                : []),
              { field: "Capture date", value: row.capture_date },
              { field: "Snapshot date", value: row.snapshot_date },
              {
                field: "Report created (UTC)",
                value: formatRecordDate(row.report_created_at, { includeTimeZone: false }),
              },
              {
                field: "Processed (UTC)",
                value: formatRecordDate(row.preprocessed_at, { includeTimeZone: false }),
              },
            ]}
          />
        </div>
      ) : null}
    </DetailDrawer>
  );
}
