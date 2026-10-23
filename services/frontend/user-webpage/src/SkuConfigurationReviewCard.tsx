import type { Ref } from "react";
import { Button, Group, Paper, Text } from "@mantine/core";
import type { SkuConfigurationChange, SkuConfigurationItem } from "./api";
import { companyLabel } from "./view-model";
import { SkuConfigurationChanges } from "./SkuConfigurationChanges";
import { SkuFeePeriods } from "./SkuFeePeriods";

export function SkuConfigurationReviewCard({
  draft,
  saved,
  companies,
  isSaving,
  editButtonRef,
  onEdit,
  onDiscard,
}: {
  draft: SkuConfigurationChange;
  saved: SkuConfigurationItem | undefined;
  companies: Map<string, string>;
  isSaving: boolean;
  editButtonRef: Ref<HTMLButtonElement>;
  onEdit: (sku: string) => void;
  onDiscard: (sku: string) => void;
}) {
  return (
    <Paper withBorder p="md" className="sku-configuration-card">
      <Group justify="space-between" align="start">
        <div className="sku-configuration-card-identity">
          <Text fw={600} className="sku-configuration-card-sku">
            {draft.sku}
          </Text>
          <Text size="sm" c="dimmed">
            {companyLabel(draft.company_id, companies)} · {draft.periods.length} fee{" "}
            {draft.periods.length === 1 ? "period" : "periods"}
          </Text>
        </div>
        <Group gap="xs">
          <Button
            ref={editButtonRef}
            variant="light"
            aria-label={`Edit ${draft.sku}`}
            disabled={isSaving}
            onClick={() => {
              onEdit(draft.sku);
            }}
          >
            Edit
          </Button>
          <Button
            variant="subtle"
            color="#9e1834"
            disabled={isSaving}
            aria-label={`Discard draft for ${draft.sku}`}
            onClick={() => {
              onDiscard(draft.sku);
            }}
          >
            Discard draft
          </Button>
        </Group>
      </Group>
      <SkuConfigurationChanges draft={draft} saved={saved} companies={companies} />
      <div className="sku-configuration-proposed-periods">
        <Text fw={600} size="sm" mb="xs">
          Proposed fee periods
        </Text>
        {draft.periods.length > 0 ? (
          <SkuFeePeriods item={draft} />
        ) : (
          <Text size="sm" c="dimmed">
            No fee periods.
          </Text>
        )}
      </div>
    </Paper>
  );
}
