import { Button, Group, Text } from "@mantine/core";
import type { Ref } from "react";
import { ColumnMenu } from "./ColumnMenu";
import {
  buildTypeFamilyOptions,
  unavailableTypeFamilyIds,
} from "./transaction-type-family-catalog";
import type { TypeFamily } from "./transaction-type-families";
import type { FilterOption } from "./filter-options";
import "./TypeFamilyFilter.css";

function comparisonLabel(family: TypeFamily): string {
  if (family.comparisonKind === "paired") return "Paired sources";
  if (family.comparisonKind === "different-basis") return "Different reporting basis";
  return family.financesTypes.length
    ? "No verified Data Kiosk mapping"
    : "No verified Finances mapping";
}

function familyOption(family: TypeFamily): FilterOption {
  return {
    value: family.id,
    label: family.label,
    title:
      family.description === family.comparisonNote
        ? family.description
        : `${family.description} ${family.comparisonNote}`,
    description: comparisonLabel(family),
  };
}

export function TypeFamilyScope({ families }: { families: readonly string[] }) {
  const unavailable = unavailableTypeFamilyIds(families);
  const selected = buildTypeFamilyOptions(
    [],
    families.filter((id) => !unavailable.includes(id)),
  );
  const labels = [
    ...selected.map((family) => family.label),
    ...unavailable.map((id) => `Unavailable: ${id}`),
  ];
  return (
    <Text size="xs" c="dimmed" className="type-family-scope">
      {families.length ? `Type families: ${labels.join(", ")}` : "All type families"}
    </Text>
  );
}

export function TypeFamilyFilter({
  families,
  options,
  unavailableFamilies = [],
  onChange,
  triggerRef,
}: {
  families: string[];
  options: TypeFamily[];
  unavailableFamilies?: string[];
  onChange: (families: string[]) => void;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="type-family-filter">
      <ColumnMenu
        triggerRef={triggerRef}
        label="Type families"
        filter={{
          kind: "selection",
          value: families,
          options: [
            ...options.map(familyOption),
            ...unavailableFamilies.map((id) => ({
              value: id,
              label: `Unavailable: ${id}`,
              description: "Remove this unavailable selection to view amounts.",
            })),
          ],
          onChange,
        }}
      />
    </div>
  );
}

export function TypeFamilyError({ error, onRetry }: { error: boolean; onRetry: () => void }) {
  return error ? (
    <Group gap="xs">
      <Text size="xs" c="red" role="alert">
        Could not load type families.
      </Text>
      <Button variant="subtle" size="compact-xs" onClick={onRetry}>
        Retry type families
      </Button>
    </Group>
  ) : null;
}
