import type { CSSProperties, ReactNode, Ref, RefObject } from "react";
import { Group } from "@mantine/core";
import { PaginationBar, type PaginationBarProps } from "./PaginationBar";
import { SearchInput } from "./SearchInput";
import { RowsSelect } from "./RowsSelect";
import { pageRangeSummary } from "./pagination";
import "./ListToolbar.css";

interface ListToolbarProps {
  label: string;
  controlsRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  search?: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    inputRef?: RefObject<HTMLInputElement | null>;
    ariaLabel?: string;
  };
  /** Scope fields shown before Rows when a list has no server-side text search. */
  filters?: ReactNode;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  pagination: Omit<PaginationBarProps, "summary">;
  rowCount: number;
  totalCount: number | null;
  items: string;
  message?: string;
  /** The previous result is shown while the next one loads, so its range is no longer current. */
  updating?: boolean;
  extraControls?: ReactNode;
}

export function ListToolbar({
  label,
  controlsRef,
  className,
  style,
  search,
  filters,
  pageSize,
  onPageSizeChange,
  pagination,
  rowCount,
  totalCount,
  items,
  message,
  updating = false,
  extraControls,
}: ListToolbarProps) {
  return (
    <Group
      ref={controlsRef}
      tabIndex={-1}
      role="group"
      aria-label={label}
      className={["table-toolbar", className].filter(Boolean).join(" ")}
      style={style}
      justify="space-between"
      align="end"
    >
      <Group align="end" className="table-toolbar-fields">
        {search ? (
          <SearchInput
            inputRef={search.inputRef}
            className="search-field"
            type="search"
            aria-label={search.ariaLabel}
            value={search.value}
            placeholder={search.placeholder}
            onChange={search.onChange}
          />
        ) : null}
        {filters}
        <RowsSelect value={pageSize} onChange={onPageSizeChange} />
        {extraControls ? (
          <Group align="end" gap="xs" className="list-toolbar-extra">
            {extraControls}
          </Group>
        ) : null}
      </Group>
      <PaginationBar
        {...pagination}
        summary={
          message ??
          (updating
            ? "Updating…"
            : pageRangeSummary(pagination.pageIndex, pageSize, rowCount, totalCount, items))
        }
      />
    </Group>
  );
}
