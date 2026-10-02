import { useId, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { OptionSearch, type ColumnMenuFilter } from "./ColumnFilters";
import { transactionTypeGroups, type TransactionTypeGroup } from "./transaction-type-groups";
import "./TransactionTypeFilter.css";

type TypeFilter = Extract<ColumnMenuFilter, { kind: "selection" }>;

function TypeGroup({
  group,
  selected,
  expanded,
  searching,
  onExpand,
  onSelect,
}: {
  group: TransactionTypeGroup;
  selected: Set<string>;
  expanded: boolean;
  searching: boolean;
  onExpand: () => void;
  onSelect: (values: string[], checked: boolean) => void;
}) {
  const optionsId = useId();
  const values = group.options.map(({ value }) => value);
  const selectedCount = values.filter((value) => selected.has(value)).length;
  return (
    <section className="type-filter-group" aria-label={group.label}>
      <div className="type-filter-group-heading">
        <Checkbox
          className="type-filter-group-choice"
          label={group.label}
          aria-describedby={`${optionsId}-scope`}
          checked={selectedCount === values.length}
          indeterminate={selectedCount > 0 && selectedCount < values.length}
          onChange={(event) => {
            onSelect(values, event.currentTarget.checked);
          }}
        />
        <VisuallyHidden id={`${optionsId}-scope`}>
          {searching
            ? "Select only matching types in this group."
            : "Select all types in this group."}
        </VisuallyHidden>
        <UnstyledButton
          className="type-filter-expand"
          aria-label={`${expanded ? "Hide" : "Show"} individual types in ${group.label}`}
          aria-expanded={expanded}
          aria-controls={optionsId}
          disabled={searching}
          onClick={onExpand}
        >
          <span>
            {selectedCount > 0 ? `${String(selectedCount)}/` : ""}
            {values.length} {searching ? "matching " : ""}
            {values.length === 1 ? "type" : "types"}
          </span>
          <span className="type-filter-chevron" aria-hidden="true" data-expanded={expanded}>
            ›
          </span>
        </UnstyledButton>
      </div>
      <div id={optionsId} hidden={!expanded} className="type-filter-leaves">
        {expanded
          ? group.options.map((option) => (
              <Checkbox
                key={option.value}
                className="column-menu-option"
                label={<span title={option.title}>{option.label}</span>}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  onSelect([option.value], event.currentTarget.checked);
                }}
              />
            ))
          : null}
      </div>
    </section>
  );
}

export function TransactionTypeFilter({
  filter,
  onClose,
}: {
  filter: TypeFilter;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const optionsRef = useRef<HTMLDivElement>(null);
  const groups = transactionTypeGroups(filter.options);
  const [expanded, setExpanded] = useState<string[]>(() =>
    groups
      .filter((group) => group.options.some(({ value }) => filter.value.includes(value)))
      .map(({ id }) => id),
  );
  const selected = new Set(filter.value);
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => {
        const groupName = group.label.toLocaleLowerCase();
        const typeName = `${option.label} ${option.value}`.toLocaleLowerCase();
        return (
          words.every((word) => groupName.includes(word)) ||
          words.every((word) => typeName.includes(word))
        );
      }),
    }))
    .filter(({ options }) => options.length > 0);
  const matches = visibleGroups.flatMap(({ options }) => options.map(({ value }) => value));

  function select(values: string[], checked: boolean) {
    const changed = new Set(values);
    filter.onChange(
      checked
        ? [...new Set([...filter.value, ...values])]
        : filter.value.filter((value) => !changed.has(value)),
    );
  }

  return (
    <Stack gap="xs">
      <OptionSearch
        label="Type"
        search={search}
        onChange={(value) => {
          setSearch(value);
          if (optionsRef.current) optionsRef.current.scrollTop = 0;
        }}
        placeholder="Search groups or individual types"
      />
      <Text size="xs" c="dimmed">
        Select a group, or expand it to choose individual types.
      </Text>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed" aria-live="polite">
          {filter.value.length === 0
            ? "All types"
            : `${String(filter.value.length)} ${filter.value.length === 1 ? "type" : "types"} selected`}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={filter.value.length === 0}
          onClick={() => {
            filter.onChange([]);
          }}
        >
          Clear type
        </Button>
      </Group>
      {searching && matches.length > 0 ? (
        <Group className="type-filter-matches" gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" aria-live="polite">
            {matches.length} matching {matches.length === 1 ? "type" : "types"}
          </Text>
          <Group gap={4}>
            <Button
              variant="subtle"
              size="compact-xs"
              disabled={matches.every((value) => selected.has(value))}
              onClick={() => {
                select(matches, true);
              }}
            >
              Select matches
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              disabled={!matches.some((value) => selected.has(value))}
              onClick={() => {
                select(matches, false);
              }}
            >
              Deselect matches
            </Button>
          </Group>
        </Group>
      ) : null}
      <div className="type-filter-groups" ref={optionsRef}>
        {visibleGroups.map((group) => (
          <TypeGroup
            key={group.id}
            group={group}
            selected={selected}
            expanded={searching || expanded.includes(group.id)}
            searching={searching}
            onExpand={() => {
              setExpanded((current) =>
                current.includes(group.id)
                  ? current.filter((id) => id !== group.id)
                  : [...current, group.id],
              );
            }}
            onSelect={select}
          />
        ))}
        {visibleGroups.length === 0 ? (
          <Text c="dimmed" size="sm" py="sm">
            {searching ? "No matching types." : "No types available."}
          </Text>
        ) : null}
      </div>
      <Group className="type-filter-footer" justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">
          Changes apply immediately.
        </Text>
        <Button size="compact-sm" onClick={onClose}>
          Done
        </Button>
      </Group>
    </Stack>
  );
}
