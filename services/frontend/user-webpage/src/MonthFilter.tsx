import { useRef, useState } from "react";
import { Button, Group, Stack, TextInput } from "@mantine/core";
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
  const monthInput = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const month = new FormData(event.currentTarget).get("month");
        if (typeof month !== "string") return;
        try {
          if (month) requireCalendarDate(`${month}-01`);
        } catch {
          setError("Choose a valid month.");
          monthInput.current?.focus();
          return;
        }
        filter.onChange(month);
        onClose();
      }}
    >
      <Stack gap="sm">
        <TextInput
          ref={monthInput}
          label="Report month"
          type="month"
          name="month"
          defaultValue={filter.value}
          data-autofocus
          error={error ? <span role="alert">{error}</span> : undefined}
          onChange={() => {
            setError(null);
          }}
        />
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
