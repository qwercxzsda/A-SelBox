import { useState } from "react";
import { Alert, Button, Checkbox, CloseButton, Group, Stack, Text, TextInput } from "@mantine/core";
import { requireCalendarDate } from "./api/filters";
import type { FilterOption } from "./filter-options";

export type ColumnMenuFilter =
  | {
      kind: "date";
      from: string;
      to: string;
      onChange: (from: string, to: string) => void;
    }
  | {
      kind: "selection";
      value: string[];
      options: FilterOption[];
      onChange: (values: string[]) => void;
    };

export function DateFilter({
  filter,
  onClose,
}: {
  filter: Extract<ColumnMenuFilter, { kind: "date" }>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const from = form.get("dateFrom");
        const to = form.get("dateTo");
        if (typeof from !== "string" || typeof to !== "string") return;
        try {
          if (from) requireCalendarDate(from);
          if (to) requireCalendarDate(to);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Choose a valid date.");
          return;
        }
        if (from && to && from > to) {
          setError("From date must be on or before To date.");
          return;
        }
        filter.onChange(from, to);
        onClose();
      }}
    >
      <Stack gap="sm">
        <div className="column-menu-dates">
          <TextInput
            label="From date"
            type="date"
            name="dateFrom"
            data-autofocus
            defaultValue={filter.from}
            onChange={() => {
              setError(null);
            }}
          />
          <TextInput
            label="To date"
            type="date"
            name="dateTo"
            defaultValue={filter.to}
            onChange={() => {
              setError(null);
            }}
          />
        </div>
        {error ? (
          <Alert role="alert" color="red">
            {error}
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

function OptionSearch({
  label,
  search,
  onChange,
}: {
  label: string;
  search: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      label={`Search ${label.toLowerCase()}`}
      placeholder="Find an option"
      data-autofocus
      value={search}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      rightSectionPointerEvents="auto"
      rightSection={
        search ? (
          <CloseButton
            aria-label="Clear option search"
            size="sm"
            onClick={() => {
              onChange("");
            }}
          />
        ) : undefined
      }
    />
  );
}

export function SelectionFilter({
  label,
  filter,
}: {
  label: string;
  filter: Extract<ColumnMenuFilter, { kind: "selection" }>;
}) {
  const [search, setSearch] = useState("");
  const searchable = filter.options.length > 8;
  const query = searchable ? search.trim().toLocaleLowerCase() : "";
  const options = filter.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query),
  );

  return (
    <Stack gap="sm">
      {searchable ? <OptionSearch label={label} search={search} onChange={setSearch} /> : null}
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed" aria-live="polite">
          {filter.value.length === 0 ? "All" : `${String(filter.value.length)} selected`}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={filter.value.length === 0}
          onClick={() => {
            filter.onChange([]);
          }}
        >
          Clear {label.toLowerCase()}
        </Button>
      </Group>
      <div className="column-menu-options">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            className="column-menu-option"
            label={<span title={option.title}>{option.label}</span>}
            checked={filter.value.includes(option.value)}
            onChange={(event) => {
              filter.onChange(
                event.currentTarget.checked
                  ? [...filter.value, option.value]
                  : filter.value.filter((value) => value !== option.value),
              );
            }}
          />
        ))}
        {options.length === 0 ? (
          <Text c="dimmed" size="sm" py="sm">
            {query ? "No matching options." : "No options available."}
          </Text>
        ) : null}
      </div>
    </Stack>
  );
}
