import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from "react";
import {
  DATASET_CONFIG,
  fetchCompanies,
  fetchDatasetPage,
  refreshSession,
  signIn,
  signOut,
  type CanonicalRow,
  type Company,
  type DatasetKey,
  type DatasetSort,
  type Session,
} from "./api";
import { LoginPanel } from "./LoginPanel";
import { RowDetail } from "./RowDetail";
import { TableCellValue } from "./Cell";
import { lastPageIndex } from "./pagination";
import {
  DATASET_ORDER,
  DATASET_PRESENTATION,
  PAGE_SIZES,
  TABLE_COLUMNS,
  getErrorMessage,
  rowId,
} from "./view-model";
import { sessionRefreshDelayMs } from "./session";
import "./App.css";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [dataset, setDataset] = useState<DatasetKey>("sku");
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<DatasetSort>(DATASET_CONFIG.sku.defaultSort);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const companyNames = useMemo(
    () => new Map(companies.map((company) => [company.id, company.company_name])),
    [companies],
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

  const clearSession = useCallback(() => {
    requestVersion.current += 1;
    setSession(null);
    setRows([]);
    setCompanies([]);
    setTotalCount(null);
    setSelectedRowId(null);
    setIsLoading(false);
    setDataError(null);
  }, []);

  useEffect(() => {
    if (!session || isSigningOut) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void refreshSession(session.refresh_token)
        .then((nextSession) => {
          if (!cancelled) {
            setSession(nextSession);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            clearSession();
            setAuthError(`Your session expired: ${getErrorMessage(error)}. Please sign in again.`);
          }
        });
    }, sessionRefreshDelayMs(session));

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [clearSession, isSigningOut, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let ignore = false;
    void fetchCompanies(session.access_token)
      .then((nextCompanies) => {
        if (!ignore) {
          setCompanies(nextCompanies);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setCompanies([]);
          setDataError(getErrorMessage(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [session]);

  const loadPage = useCallback(async () => {
    if (!session) {
      return;
    }

    const activeRequest = requestVersion.current + 1;
    requestVersion.current = activeRequest;
    setIsLoading(true);
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

  async function handleSignIn(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const nextSession = await signIn(email.trim(), password);
      setSession(nextSession);
      setPassword("");
      setPageIndex(0);
      setRows([]);
      setTotalCount(null);
    } catch (error) {
      clearSession();
      setAuthError(getErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    if (!session) {
      return;
    }

    setIsSigningOut(true);
    setAuthError(null);
    try {
      await signOut(session.access_token);
    } catch (error) {
      setAuthError(`The remote session could not be revoked: ${getErrorMessage(error)}`);
    } finally {
      clearSession();
      setIsSigningOut(false);
    }
  }

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
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">A-SelBox · published settlement ledger</p>
            <h1>SKU Economics</h1>
          </div>
          {session ? (
            <div className="session-panel">
              <span className="session-identity">
                <span>Signed in</span>
                <strong>{session.user.email ?? email}</strong>
              </span>
              <button
                className="secondary-button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </header>

        {!session ? (
          <LoginPanel
            email={email}
            errorMessage={authError}
            isSigningIn={isSigningIn}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={(event) => void handleSignIn(event)}
            password={password}
          />
        ) : (
          <>
            <nav className="dataset-tabs" aria-label="Published read models">
              {DATASET_ORDER.map((key) => (
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
                <span className="summary-label">Published targets</span>
                <strong>{totalCount === null ? "—" : totalCount.toLocaleString("en-US")}</strong>
              </div>
              <div className="summary-item">
                <span className="summary-label">Read model</span>
                <strong>{presentation.label}</strong>
              </div>
              <div className="summary-item">
                <span className="summary-label">Access</span>
                <strong>Authenticated · RLS</strong>
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
                              <TableCellValue column={column} companies={companyNames} row={row} />
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

              {isLoading ? <div className="loading-state">Loading published targets…</div> : null}
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
              <RowDetail companies={companyNames} dataset={dataset} row={selectedRow} />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

export default App;
