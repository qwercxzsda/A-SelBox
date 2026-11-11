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
  search: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    inputRef?: RefObject<HTMLInputElement | null>;
    ariaLabel?: string;
  };
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  pagination: Omit<PaginationBarProps, "summary">;
  rowCount: number;
  totalCount: number | null;
  items: string;
  message?: string;
  extraControls?: ReactNode;
}

export function ListToolbar({
  label,
  controlsRef,
  className,
  style,
  search,
  pageSize,
  onPageSizeChange,
  pagination,
  rowCount,
  totalCount,
  items,
  message,
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
        <SearchInput
          inputRef={search.inputRef}
          className="search-field"
          type="search"
          aria-label={search.ariaLabel}
          value={search.value}
          placeholder={search.placeholder}
          onChange={search.onChange}
        />
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
          message ?? pageRangeSummary(pagination.pageIndex, pageSize, rowCount, totalCount, items)
        }
      />
    </Group>
  );
}
