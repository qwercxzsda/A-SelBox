import { Drawer, Text, Title } from "@mantine/core";
import type { InventoryRow } from "./api/inventory";
import { DetailSection } from "./DetailSection";
import {
  InventoryHealthLabel,
  InventoryMetrics,
  InventoryRecommendationLabel,
} from "./InventoryMetrics";
import { INVENTORY_METRICS } from "./inventory-metrics";
import { SkuTransactionLink } from "./SkuTransactionLink";
import "./InventoryDetail.css";

export function InventoryDetail({
  row,
  onClose,
  onShowTransactions,
}: {
  row: InventoryRow | null;
  onClose: () => void;
  onShowTransactions: (sku: string) => void;
}) {
  return (
    <Drawer
      id="inventory-details"
      opened={row !== null}
      onClose={onClose}
      position="right"
      size="min(1000px, 100vw)"
      padding="lg"
      title="Inventory details"
      closeButtonProps={{ "aria-label": "Close inventory details" }}
    >
      {row ? (
        <div className="inventory-detail">
          <Title order={3} className="inventory-detail-title">
            <SkuTransactionLink sku={row.sku} onShowTransactions={onShowTransactions} />
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {row.marketplace_name}
          </Text>
          <Text size="sm" c="dimmed" mt="xs" mb="lg">
            Latest daily capture. Quantities are reported estimates; unavailable values appear as —.
          </Text>
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
          <DetailSection title="Source capture" stateKey="inventory:source-capture" collapsible>
            <InventoryMetrics
              row={row}
              fields={INVENTORY_METRICS.source}
              className="inventory-detail-source"
            />
          </DetailSection>
        </div>
      ) : null}
    </Drawer>
  );
}
