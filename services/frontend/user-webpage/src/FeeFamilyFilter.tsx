import { Button, Group, Text } from "@mantine/core";
import type { Ref } from "react";
import { ColumnMenu } from "./ColumnMenu";
import { buildFeeFamilyOptions } from "./fee-family-catalog";
import type { FeeFamily } from "./fee-family-definitions";
import "./FeeFamilyFilter.css";

export function FeeFamilyScope({ families }: { families: readonly string[] }) {
  const selected = buildFeeFamilyOptions([], families);
  return (
    <Text size="xs" c="dimmed" className="fee-family-scope">
      {families.length
        ? `Fee families: ${selected.map((family) => family.label).join(", ")}`
        : "All fee families"}
    </Text>
  );
}

export function FeeFamilyFilter({
  families,
  options,
  onChange,
  triggerRef,
}: {
  families: string[];
  options: FeeFamily[];
  onChange: (families: string[]) => void;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="fee-family-filter">
      <ColumnMenu
        triggerRef={triggerRef}
        label="Fee families"
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

export function FeeFamilyError({ error, onRetry }: { error: boolean; onRetry: () => void }) {
  return error ? (
    <Group gap="xs">
      <Text size="xs" c="red" role="alert">
        Could not load fee families.
      </Text>
      <Button variant="subtle" size="compact-xs" onClick={onRetry}>
        Retry fee families
      </Button>
    </Group>
  ) : null;
}
