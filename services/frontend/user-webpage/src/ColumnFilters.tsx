import { useRef, useState, type RefObject } from "react";
import { Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import type { FilterOption } from "./filter-options";
import { SearchInput } from "./SearchInput";

export type ColumnMenuFilter =
  | {
      kind: "month";
      value: string;
      onChange: (value: string) => void;
    }
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
      groupBy?: "transaction-type";
      onChange: (values: string[]) => void;
    };

export function OptionSearch({
  inputRef,
  label,
  search,
  onChange,
  onResetScroll,
  placeholder = "Find an option",
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  search: string;
  onChange: (value: string) => void;
  onResetScroll: () => void;
  placeholder?: string;
}) {
  function changeSearch(value: string) {
    onChange(value);
    onResetScroll();
  }

  return (
    <SearchInput
      inputRef={inputRef}
      label={`Search ${label.toLowerCase()}`}
      placeholder={placeholder}
      data-autofocus
      value={search}
      onChange={changeSearch}
      clearLabel="Clear option search"
      clearButtonSize="sm"
    />
  );
}

export function SelectionFilter({
  label,
  filter,
  onResetScroll,
}: {
  label: string;
  filter: Extract<ColumnMenuFilter, { kind: "selection" }>;
  onResetScroll: () => void;
}) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const firstOption = useRef<HTMLInputElement>(null);
  const searchable = filter.options.length > 8;
  const query = searchable ? search.trim().toLocaleLowerCase() : "";
  const options = filter.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query),
  );

  return (
    <Stack gap="sm">
      {searchable ? (
        <OptionSearch
          inputRef={searchInput}
          label={label}
          search={search}
          onChange={setSearch}
          onResetScroll={onResetScroll}
        />
      ) : null}
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed" aria-live="polite">
          {filter.value.length === 0 ? "All" : `${String(filter.value.length)} selected`}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={filter.value.length === 0}
          onClick={(event) => {
            if (event.detail === 0) (searchable ? searchInput : firstOption).current?.focus();
            filter.onChange([]);
          }}
        >
          Clear {label.toLowerCase()}
        </Button>
      </Group>
      <div className="column-menu-options">
        {options.map((option, index) => (
          <Checkbox
            key={option.value}
            ref={index === 0 ? firstOption : undefined}
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
