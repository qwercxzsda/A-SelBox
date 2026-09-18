import { useId, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  CloseButton,
  Divider,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import "./ColumnMenu.css";

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
      options: { value: string; label: string }[];
      onChange: (values: string[]) => void;
      isLoading?: boolean;
      error?: string;
      onRetry?: () => void;
    };

export interface ColumnMenuSort {
  direction: "asc" | "desc" | false;
  onChange: (direction: "asc" | "desc") => void;
  ascendingLabel: string;
  descendingLabel: string;
}

export interface ColumnMenuProps {
  label: string;
  filter?: ColumnMenuFilter;
  sort?: ColumnMenuSort;
  onOpen?: () => void;
  onClose?: () => void;
}

function DateFilter({
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

function SelectionFilter({
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
      {searchable ? (
        <TextInput
          label={`Search ${label.toLowerCase()}`}
          placeholder="Find an option"
          data-autofocus
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
          }}
          rightSectionPointerEvents="auto"
          rightSection={
            search ? (
              <CloseButton
                aria-label="Clear option search"
                size="sm"
                onClick={() => {
                  setSearch("");
                }}
              />
            ) : undefined
          }
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
          onClick={() => {
            filter.onChange([]);
          }}
        >
          Clear {label.toLowerCase()}
        </Button>
      </Group>
      {filter.isLoading ? (
        <Text role="status" size="sm" c="dimmed">
          Loading options…
        </Text>
      ) : null}
      {filter.error ? (
        <Alert role="alert" color="red">
          <Stack align="start" gap="xs">
            {filter.error}
            {filter.onRetry ? (
              <Button variant="subtle" color="red" onClick={filter.onRetry}>
                Retry options
              </Button>
            ) : null}
          </Stack>
        </Alert>
      ) : null}
      <div className="column-menu-options" aria-busy={filter.isLoading}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            className="column-menu-option"
            label={option.label}
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
        {!filter.isLoading && !filter.error && options.length === 0 ? (
          <Text c="dimmed" size="sm" py="sm">
            {query ? "No matching options." : "No options available."}
          </Text>
        ) : null}
      </div>
    </Stack>
  );
}

export function ColumnMenu({ label, filter, sort, onOpen, onClose }: ColumnMenuProps) {
  const [opened, setOpened] = useState(false);
  const titleId = useId();
  const filterCount =
    filter?.kind === "selection"
      ? filter.value.length
      : filter?.kind === "date" && (filter.from || filter.to)
        ? 1
        : 0;

  function changeOpened(nextOpened: boolean) {
    if (nextOpened === opened) return;
    setOpened(nextOpened);
    if (nextOpened) onOpen?.();
    else onClose?.();
  }
  function close() {
    changeOpened(false);
  }

  return (
    <Popover
      opened={opened}
      onChange={changeOpened}
      width="min(340px, calc(100vw - 24px))"
      position="bottom-start"
      shadow="md"
      trapFocus
      returnFocus
      withinPortal
    >
      <Popover.Target>
        <UnstyledButton
          className="column-menu-trigger"
          aria-label={label}
          data-filtered={filterCount > 0 || undefined}
          onClick={() => {
            changeOpened(!opened);
          }}
        >
          <span>{label}</span>
          <span className="column-menu-indicators" aria-hidden="true">
            {filter ? (
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M2 3h12L9.5 8.3V13l-3-1.5V8.3Z" />
              </svg>
            ) : null}
            {filterCount > 0 ? <span className="column-menu-count">{filterCount}</span> : null}
            {sort ? (
              <span>{sort.direction === "asc" ? "↑" : sort.direction === "desc" ? "↓" : "↕"}</span>
            ) : null}
          </span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className="column-menu-dropdown" aria-labelledby={titleId}>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm" id={titleId}>
              {label} options
            </Text>
            <CloseButton aria-label="Close options" onClick={close} />
          </Group>
          {opened && filter?.kind === "date" ? (
            <DateFilter filter={filter} onClose={close} />
          ) : null}
          {opened && filter?.kind === "selection" ? (
            <SelectionFilter label={label} filter={filter} />
          ) : null}
          {filter && sort ? <Divider /> : null}
          {sort ? (
            <Stack gap={4}>
              {(["desc", "asc"] as const).map((direction, index) => (
                <Button
                  key={direction}
                  variant={sort.direction === direction ? "light" : "subtle"}
                  aria-pressed={sort.direction === direction}
                  data-autofocus={(!filter && index === 0) || undefined}
                  justify="flex-start"
                  fullWidth
                  onClick={() => {
                    sort.onChange(direction);
                    close();
                  }}
                >
                  {direction === "asc" ? sort.ascendingLabel : sort.descendingLabel}
                </Button>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
