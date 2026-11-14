import { Button, Group, Text } from "@mantine/core";
import type { Ref } from "react";
import { ColumnMenu } from "./ColumnMenu";
import { buildTypeFamilyOptions } from "./transaction-type-family-catalog";
import type { TypeFamily } from "./transaction-type-families";
import "./TypeFamilyFilter.css";

export function TypeFamilyScope({ families }: { families: readonly string[] }) {
  const selected = buildTypeFamilyOptions([], families);
  return (
    <Text size="xs" c="dimmed" className="type-family-scope">
      {families.length
        ? `Type families: ${selected.map((family) => family.label).join(", ")}`
        : "All type families"}
    </Text>
  );
}

export function TypeFamilyFilter({
  families,
  options,
  onChange,
  triggerRef,
}: {
  families: string[];
  options: TypeFamily[];
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
          options: options.map((family) => ({
            value: family.id,
            label: family.label,
            title: family.description,
          })),
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
