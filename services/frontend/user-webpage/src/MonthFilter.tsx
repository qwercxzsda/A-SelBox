import { useState } from "react";
import { Alert, Button, Group, Stack, TextInput } from "@mantine/core";
import { requireCalendarDate } from "./api/filters";
import type { ColumnMenuFilter } from "./ColumnFilters";

export function MonthFilter({
  filter,
  onClose,
}: {
  filter: Extract<ColumnMenuFilter, { kind: "month" }>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const month = new FormData(event.currentTarget).get("month");
        if (typeof month !== "string") return;
        try {
          if (month) requireCalendarDate(`${month}-01`);
          filter.onChange(month);
          onClose();
        } catch {
          setError("Choose a valid month.");
        }
      }}
    >
      <Stack gap="sm">
        <TextInput
          label="Report month"
          type="month"
          name="month"
          defaultValue={filter.value}
          data-autofocus
          onChange={() => {
            setError(null);
          }}
        />
        {error ? (
          <Alert role="alert" color="red">
            {error}
          </Alert>
        ) : null}
        <Group gap="xs" justify="space-between">
          <Button
            variant="subtle"
            onClick={() => {
              filter.onChange("");
              onClose();
            }}
          >
            Clear month
          </Button>
          <Button type="submit">Apply month</Button>
        </Group>
      </Stack>
    </form>
  );
}
