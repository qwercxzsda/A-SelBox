import { useId, useRef, useState } from "react";
import { Alert, Button, Group, Stack, TextInput } from "@mantine/core";
import { requireCalendarDate } from "./api/filters";
import type { ColumnMenuFilter } from "./ColumnFilters";

interface DateFilterError {
  field: "from" | "to" | "range";
  message: string;
}

function validateDates(from: string, to: string): DateFilterError | null {
  for (const [field, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    try {
      if (value) requireCalendarDate(value);
    } catch (error) {
      return { field, message: error instanceof Error ? error.message : "Choose a valid date." };
    }
  }
  return from && to && from > to
    ? { field: "range", message: "From date must be on or before To date." }
    : null;
}

export function DateFilter({
  filter,
  onClose,
}: {
  filter: Extract<ColumnMenuFilter, { kind: "date" }>;
  onClose: () => void;
}) {
  const [error, setError] = useState<DateFilterError | null>(null);
  const errorId = useId();
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const fromInvalid = Boolean(error && error.field !== "to");
  const toInvalid = Boolean(error && error.field !== "from");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const from = form.get("dateFrom");
        const to = form.get("dateTo");
        if (typeof from !== "string" || typeof to !== "string") return;
        const validationError = validateDates(from, to);
        if (validationError) {
          setError(validationError);
          (validationError.field === "to" ? toInput : fromInput).current?.focus();
          return;
        }
        filter.onChange(from, to);
        onClose();
      }}
    >
      <Stack gap="sm">
        <div className="column-menu-dates">
          <TextInput
            ref={fromInput}
            label="From date"
            type="date"
            name="dateFrom"
            data-autofocus
            defaultValue={filter.from}
            error={fromInvalid}
            attributes={{ input: { "aria-describedby": fromInvalid ? errorId : undefined } }}
            onChange={() => {
              setError(null);
            }}
          />
          <TextInput
            ref={toInput}
            label="To date"
            type="date"
            name="dateTo"
            defaultValue={filter.to}
            error={toInvalid}
            attributes={{ input: { "aria-describedby": toInvalid ? errorId : undefined } }}
            onChange={() => {
              setError(null);
            }}
          />
        </div>
        {error ? (
          <Alert id={errorId} role="alert" color="red">
            {error.message}
          </Alert>
        ) : null}
        <Group gap="xs" justify="space-between">
          <Button
            variant="subtle"
            onClick={() => {
              filter.onChange("", "");
              onClose();
            }}
          >
            Clear dates
          </Button>
          <Button type="submit">Apply dates</Button>
        </Group>
      </Stack>
    </form>
  );
}
