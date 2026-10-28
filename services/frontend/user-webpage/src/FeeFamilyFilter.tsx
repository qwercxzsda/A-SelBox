import { Button, Stack, Text } from "@mantine/core";
import { useRef } from "react";
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
  loading,
  error,
  onChange,
  onRetry,
}: {
  families: string[];
  options: FeeFamily[];
  loading: boolean;
  error: boolean;
  onChange: (families: string[]) => void;
  onRetry: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Stack gap="xs" className="fee-family-filter">
      <ColumnMenu
        triggerRef={trigger}
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
      {loading ? (
        <Text size="xs" c="dimmed" role="status">
          Loading fee families…
        </Text>
      ) : null}
      {error ? (
        <Text size="xs" c="red" role="alert">
          Could not load fee families.
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              trigger.current?.focus();
              onRetry();
            }}
          >
            Retry fee families
          </Button>
        </Text>
      ) : null}
    </Stack>
  );
}
