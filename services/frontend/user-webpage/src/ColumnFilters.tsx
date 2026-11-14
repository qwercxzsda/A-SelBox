import { useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  placeholder = label,
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
      aria-label={`Search ${label.toLowerCase()}`}
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
  onClearFocusFallback,
  onSearchAvailable,
}: {
  label: string;
  filter: Extract<ColumnMenuFilter, { kind: "selection" }>;
  onResetScroll: () => void;
  onClearFocusFallback: () => void;
  onSearchAvailable: (input: HTMLInputElement) => void;
}) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const firstOption = useRef<HTMLInputElement>(null);
  const clearFocusTarget = useRef<HTMLInputElement | null>(null);
  const searchable = filter.options.length > 8;
  const wasSearchable = useRef(searchable);
  const query = searchable ? search.trim().toLocaleLowerCase() : "";
  const options = filter.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query),
  );

  useLayoutEffect(() => {
    if (!wasSearchable.current && searchable && searchInput.current)
      onSearchAvailable(searchInput.current);
    wasSearchable.current = searchable;
  }, [searchable, onSearchAvailable]);

  useLayoutEffect(() => {
    const target = clearFocusTarget.current;
    clearFocusTarget.current = null;
    // Clearing can remove an option retained only by its previous selection.
    if (
      target &&
      !target.isConnected &&
      (document.activeElement === document.body ||
        document.activeElement === document.documentElement)
    )
      onClearFocusFallback();
  }, [filter.value, filter.options, onClearFocusFallback]);

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
            if (event.detail === 0) {
              const target = (searchable ? searchInput : firstOption).current;
              clearFocusTarget.current = target;
              if (target) target.focus();
              else onClearFocusFallback();
            }
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
            description={option.description}
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
