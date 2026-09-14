import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  DATASET_CONFIG,
  fetchDatasetPage,
  type CanonicalRow,
  type DatasetKey,
  type DatasetSort,
} from "./api";
import { RowDetail } from "./RowDetail";
import { TableCellValue } from "./Cell";
import { lastPageIndex } from "./pagination";
import {
  visibleDatasets,
  companyLabel,
  DATASET_PRESENTATION,
  PAGE_SIZES,
  TABLE_COLUMNS,
  getErrorMessage,
  rowId,
} from "./view-model";
import type { Identity } from "./use-auth";

export function FinanceWorkspace({ identity }: { identity: Identity }) {
  const { session, account } = identity;
  const [dataset, setDataset] = useState<DatasetKey>("live");
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<DatasetSort>(DATASET_CONFIG.live.defaultSort);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const companyNames = useMemo(
    () => new Map(identity.companies.map((company) => [company.id, company.name])),
    [identity],
  );
  const skuNames = useMemo(
    () => new Map(identity.assignments.map((item) => [item.id, item.sku])),
    [identity],
  );
  const selectedRow = useMemo(
    () => rows.find((row) => rowId(row) === selectedRowId) ?? rows.at(0) ?? null,
    [rows, selectedRowId],
  );
  const totalPages = totalCount === null ? null : Math.max(1, Math.ceil(totalCount / pageSize));
  const firstVisible = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const lastVisible = pageIndex * pageSize + rows.length;
  const hasNextPage = totalPages === null ? rows.length === pageSize : pageIndex + 1 < totalPages;
  const columns = TABLE_COLUMNS[dataset];
  const presentation = DATASET_PRESENTATION[dataset];

  const loadPage = useCallback(async () => {
    const activeRequest = requestVersion.current + 1;
    requestVersion.current = activeRequest;
    setIsLoading(true);
    setRows([]);
    setSelectedRowId(null);
    setDataError(null);

    try {
      const result = await fetchDatasetPage({
        accessToken: session.access_token,
        dataset,
        pageIndex,
        pageSize,
        search: deferredSearch,
        sort,
      });
      if (requestVersion.current === activeRequest) {
        if (result.totalCount !== null) {
          const finalPageIndex = lastPageIndex(result.totalCount, pageSize);
          if (pageIndex > finalPageIndex) {
            setRows([]);
            setTotalCount(result.totalCount);
            setSelectedRowId(null);
            setPageIndex(finalPageIndex);
            return;
          }
        }
        setRows(result.rows);
        setTotalCount(result.totalCount);
      }
    } catch (error) {
      if (requestVersion.current === activeRequest) {
        setRows([]);
        setTotalCount(null);
        setDataError(getErrorMessage(error));
      }
    } finally {
      if (requestVersion.current === activeRequest) {
        setIsLoading(false);
      }
    }
  }, [dataset, deferredSearch, pageIndex, pageSize, session, sort]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadPage();
      }
    });
    return () => {
      cancelled = true;
      requestVersion.current += 1;
    };
  }, [loadPage]);

  function selectDataset(nextDataset: DatasetKey) {
    requestVersion.current += 1;
    setDataset(nextDataset);
    setSort(DATASET_CONFIG[nextDataset].defaultSort);
    setSearch("");
    setPageIndex(0);
    setRows([]);
    setTotalCount(null);
    setSelectedRowId(null);
  }

  function toggleSort(column: string) {
    setPageIndex(0);
    setSort((currentSort) => ({
      column,
      direction: currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <>
      <nav className="dataset-tabs" aria-label="Financial data">
        {visibleDatasets(account).map((key) => (
          <button
            aria-pressed={dataset === key}
            className={dataset === key ? "active" : undefined}
            key={key}
            onClick={() => {
              selectDataset(key);
            }}
            type="button"
          >
            {DATASET_PRESENTATION[key].label}
          </button>
        ))}
      </nav>

      <p className="info-banner">{presentation.description}</p>
      {dataError ? (
        <p className="error-banner" role="alert">
          {dataError}
        </p>
      ) : null}

      <section className="summary-grid" aria-live="polite">
        <div className="summary-item">
          <span className="summary-label">Matching rows</span>
          <strong>{totalCount === null ? "—" : totalCount.toLocaleString("en-US")}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">View</span>
          <strong>{presentation.label}</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">Access</span>
          <strong>
            {account.access_role === "operator"
              ? "All companies"
              : companyLabel(account.company_id, companyNames)}
          </strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">Page</span>
          <strong>
            {pageIndex + 1} / {totalPages ?? "—"}
          </strong>
        </div>
      </section>

      <section className="table-toolbar">
        <div className="table-toolbar-fields">
          <label className="search-field">
            <span>Search</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPageIndex(0);
              }}
              disabled={DATASET_CONFIG[dataset].searchColumns.length === 0}
              placeholder={presentation.searchPlaceholder}
              type="search"
              value={search}
            />
          </label>
          <label className="page-size-field">
            <span>Rows</span>
            <select
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPageIndex(0);
              }}
              value={pageSize}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary-button"
          disabled={isLoading}
          onClick={() => {
            void loadPage();
          }}
          type="button"
        >
          Refresh
        </button>
      </section>

      <section className="table-card" aria-busy={isLoading}>
        <div className="table-scroll">
          <table style={{ minWidth: Math.max(980, columns.length * 132) }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    aria-sort={
                      column.sortable
                        ? sort.column === column.sortable
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className={column.align === "right" ? "numeric" : undefined}
                    key={column.key}
                    scope="col"
                  >
                    {column.sortable ? (
                      <button
                        className="sort-button"
                        onClick={() => {
                          toggleSort(column.sortable ?? column.key);
                        }}
                        type="button"
                      >
                        {column.label}
                        <span className="sort-indicator" aria-hidden="true">
                          {sort.column === column.sortable
                            ? sort.direction === "asc"
                              ? "▲"
                              : "▼"
                            : "↕"}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = rowId(row);
                const isSelected = id === (selectedRow ? rowId(selectedRow) : null);
                return (
                  <tr className={isSelected ? "selected" : undefined} key={id}>
                    {columns.map((column) => (
                      <td
                        className={column.align === "right" ? "numeric" : undefined}
                        key={column.key}
                      >
                        <TableCellValue
                          column={column}
                          companies={companyNames}
                          row={row}
                          skuNames={skuNames}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        aria-pressed={isSelected}
                        className="detail-button"
                        onClick={() => {
                          setSelectedRowId(id);
                        }}
                        type="button"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {isLoading ? <div className="loading-state">Loading rows…</div> : null}
        {!isLoading && rows.length === 0 ? (
          <div className="empty-state">{presentation.emptyMessage}</div>
        ) : null}
      </section>

      <footer className="pagination-bar">
        <span>
          {firstVisible.toLocaleString("en-US")}-{lastVisible.toLocaleString("en-US")} of{" "}
          {totalCount === null ? "—" : totalCount.toLocaleString("en-US")}
        </span>
        <div className="pagination-actions">
          <button
            className="secondary-button"
            disabled={pageIndex === 0 || isLoading}
            onClick={() => {
              setPageIndex((currentPage) => currentPage - 1);
            }}
            type="button"
          >
            Previous
          </button>
          <button
            className="secondary-button"
            disabled={!hasNextPage || isLoading}
            onClick={() => {
              setPageIndex((currentPage) => currentPage + 1);
            }}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>

      {selectedRow ? (
        <RowDetail
          companies={companyNames}
          dataset={dataset}
          row={selectedRow}
          skuNames={skuNames}
        />
      ) : null}
    </>
  );
}
