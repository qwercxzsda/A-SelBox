import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const DEFAULT_SUPABASE_URL =
  globalThis.location?.hostname === "host.docker.internal"
    ? "http://host.docker.internal:54321"
    : "http://127.0.0.1:54321";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

type DemoAccount = {
  label: string;
  email: string;
  password: string;
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    label: "User One",
    email: "user-one@example.com",
    password: "password123",
  },
  {
    label: "User Two",
    email: "user-two@example.com",
    password: "password123",
  },
  {
    label: "Admin",
    email: "admin@example.com",
    password: "password123",
  },
];

type OrderTransaction = {
  id: string;
  amz_posted_date_time: string;
  amz_sku: string;
  amz_order_id: string;
  amz_marketplace_name: string | null;
  amz_order_item_price: string | null;
  amz_order_item_fees: string | null;
  amz_order_item_withheld_tax: string | null;
  amz_order_promotion: string | null;
  amz_refund: string | null;
  amz_others: string | null;
  selbox_fees: string | null;
  net_amount: string;
  amz_quantity_purchased: number | null;
  amz_currency: string;
  company_name: string | null;
};

type NoSkuTransaction = {
  id: string;
  amz_posted_date_time: string;
  amz_sku: string;
  amz_order_id: string | null;
  amz_marketplace_name: string | null;
  amz_transaction_type: string;
  amz_amount_type: string;
  amz_amount_description: string;
  amz_amount: string;
  amz_currency: string;
  company_name: string | null;
};

type Session = {
  access_token: string;
  user: {
    email?: string;
  };
};

type ActiveTab = "orders" | "no_sku";

type SortColumn =
  | "amz_posted_date_time"
  | "company_name"
  | "amz_sku"
  | "amz_order_id"
  | "amz_order_item_price"
  | "amz_order_item_fees"
  | "amz_order_item_withheld_tax"
  | "amz_order_promotion"
  | "amz_refund"
  | "amz_others"
  | "selbox_fees"
  | "net_amount"
  | "amz_transaction_type"
  | "amz_amount_type"
  | "amz_amount_description"
  | "amz_amount";

type FixedColumn =
  | "amz_posted_date_time"
  | "company_name"
  | "amz_marketplace_name"
  | "amz_sku"
  | "amz_order_id"
  | "amz_quantity_purchased";

type AmountColumn =
  | "amz_order_item_price"
  | "amz_order_item_fees"
  | "amz_order_item_withheld_tax"
  | "amz_order_promotion"
  | "amz_refund"
  | "amz_others"
  | "selbox_fees"
  | "net_amount";

type NoSkuColumn =
  | "amz_posted_date_time"
  | "company_name"
  | "amz_marketplace_name"
  | "amz_sku"
  | "amz_order_id"
  | "amz_transaction_type"
  | "amz_amount_type"
  | "amz_amount_description"
  | "amz_amount";

type DisplayColumn = FixedColumn | AmountColumn | NoSkuColumn;

type SortDirection = "asc" | "desc";

type SortState = {
  column: SortColumn;
  direction: SortDirection;
};

type ColumnDefinition = {
  key: DisplayColumn;
  label: string;
  sortable?: SortColumn;
  align?: "right";
  kind?: "date" | "integer" | "money" | "text";
};

const FIXED_COLUMNS: ColumnDefinition[] = [
  {
    key: "amz_posted_date_time",
    label: "Posted",
    sortable: "amz_posted_date_time",
    kind: "date",
  },
  { key: "company_name", label: "Company", sortable: "company_name" },
  { key: "amz_marketplace_name", label: "Market" },
  { key: "amz_sku", label: "SKU", sortable: "amz_sku" },
  { key: "amz_order_id", label: "Order ID", sortable: "amz_order_id" },
  {
    key: "amz_quantity_purchased",
    label: "Qty",
    align: "right",
    kind: "integer",
  },
];

const AMOUNT_COLUMNS: ColumnDefinition[] = [
  {
    key: "amz_order_item_price",
    label: "Item Price",
    sortable: "amz_order_item_price",
    align: "right",
    kind: "money",
  },
  {
    key: "amz_order_item_fees",
    label: "Item Fees",
    sortable: "amz_order_item_fees",
    align: "right",
    kind: "money",
  },
  {
    key: "amz_order_item_withheld_tax",
    label: "Withheld Tax",
    sortable: "amz_order_item_withheld_tax",
    align: "right",
    kind: "money",
  },
  {
    key: "amz_order_promotion",
    label: "Promotion",
    sortable: "amz_order_promotion",
    align: "right",
    kind: "money",
  },
  {
    key: "amz_refund",
    label: "Refund",
    sortable: "amz_refund",
    align: "right",
    kind: "money",
  },
  {
    key: "amz_others",
    label: "Others",
    sortable: "amz_others",
    align: "right",
    kind: "money",
  },
  {
    key: "selbox_fees",
    label: "SelBox Fee",
    sortable: "selbox_fees",
    align: "right",
    kind: "money",
  },
  {
    key: "net_amount",
    label: "Net",
    sortable: "net_amount",
    align: "right",
    kind: "money",
  },
];

const DEFAULT_VISIBLE_AMOUNT_COLUMNS: AmountColumn[] = [
  "amz_order_item_price",
  "selbox_fees",
  "net_amount",
];

const NO_SKU_COLUMNS: ColumnDefinition[] = [
  {
    key: "amz_posted_date_time",
    label: "Posted",
    sortable: "amz_posted_date_time",
    kind: "date",
  },
  { key: "company_name", label: "Company", sortable: "company_name" },
  { key: "amz_marketplace_name", label: "Market" },
  { key: "amz_sku", label: "SKU", sortable: "amz_sku" },
  { key: "amz_order_id", label: "Order ID", sortable: "amz_order_id" },
  {
    key: "amz_transaction_type",
    label: "Transaction",
    sortable: "amz_transaction_type",
  },
  {
    key: "amz_amount_type",
    label: "Amount Type",
    sortable: "amz_amount_type",
  },
  {
    key: "amz_amount_description",
    label: "Description",
    sortable: "amz_amount_description",
  },
  {
    key: "amz_amount",
    label: "Amount",
    sortable: "amz_amount",
    align: "right",
    kind: "money",
  },
];

const DEFAULT_SORT_BY_TAB: Record<ActiveTab, SortState> = {
  orders: {
    column: "amz_posted_date_time",
    direction: "desc",
  },
  no_sku: {
    column: "amz_posted_date_time",
    direction: "desc",
  },
};

const PAGE_SIZES = [25, 50, 100];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("en-US");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function parseTotalCount(contentRange: string | null): number | null {
  if (!contentRange) {
    return null;
  }

  const total = contentRange.split("/")[1];
  if (!total || total === "*") {
    return null;
  }

  const parsed = Number.parseInt(total, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value: string | null, currency: string): string {
  if (value === null) {
    return "-";
  }

  return `${currencyFormatter.format(Number(value))} ${currency}`;
}

function sanitizeSearchTerm(value: string): string {
  return value.trim().replace(/[*,()]/g, " ");
}

async function signIn(account: DemoAccount): Promise<Session> {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Sign in failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<Session>;
}

async function fetchOrderTransactions({
  accessToken,
  pageIndex,
  pageSize,
  search,
  sort,
}: {
  accessToken: string;
  pageIndex: number;
  pageSize: number;
  search: string;
  sort: SortState;
}): Promise<{ rows: OrderTransaction[]; totalCount: number | null }> {
  const params = new URLSearchParams();
  params.set(
    "select",
    [
      "id",
      "amz_posted_date_time",
      "amz_sku",
      "amz_order_id",
      "amz_marketplace_name",
      "amz_order_item_price",
      "amz_order_item_fees",
      "amz_order_item_withheld_tax",
      "amz_order_promotion",
      "amz_refund",
      "amz_others",
      "selbox_fees",
      "net_amount",
      "amz_quantity_purchased",
      "amz_currency",
      "company_name",
    ].join(","),
  );
  params.set("order", `${sort.column}.${sort.direction}.nullslast`);
  params.set("limit", String(pageSize));
  params.set("offset", String(pageIndex * pageSize));

  const sanitizedSearch = sanitizeSearchTerm(search);
  if (sanitizedSearch) {
    const pattern = `*${sanitizedSearch}*`;
    const searchFilters = [
      `amz_order_id.ilike.${pattern}`,
      `amz_sku.ilike.${pattern}`,
      `amz_marketplace_name.ilike.${pattern}`,
      `company_name.ilike.${pattern}`,
    ].join(",");
    params.set("or", `(${searchFilters})`);
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/order_transactions_view?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: "count=exact",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Transaction query failed with HTTP ${response.status}`);
  }

  return {
    rows: (await response.json()) as OrderTransaction[],
    totalCount: parseTotalCount(response.headers.get("Content-Range")),
  };
}

async function fetchNoSkuTransactions({
  accessToken,
  pageIndex,
  pageSize,
  search,
  sort,
}: {
  accessToken: string;
  pageIndex: number;
  pageSize: number;
  search: string;
  sort: SortState;
}): Promise<{ rows: NoSkuTransaction[]; totalCount: number | null }> {
  const params = new URLSearchParams();
  params.set(
    "select",
    [
      "id",
      "amz_posted_date_time",
      "amz_sku",
      "amz_order_id",
      "amz_marketplace_name",
      "amz_transaction_type",
      "amz_amount_type",
      "amz_amount_description",
      "amz_amount",
      "amz_currency",
      "company_name",
    ].join(","),
  );
  params.set("order", `${sort.column}.${sort.direction}.nullslast`);
  params.set("limit", String(pageSize));
  params.set("offset", String(pageIndex * pageSize));

  const sanitizedSearch = sanitizeSearchTerm(search);
  if (sanitizedSearch) {
    const pattern = `*${sanitizedSearch}*`;
    const searchFilters = [
      `amz_order_id.ilike.${pattern}`,
      `amz_sku.ilike.${pattern}`,
      `amz_marketplace_name.ilike.${pattern}`,
      `company_name.ilike.${pattern}`,
      `amz_transaction_type.ilike.${pattern}`,
      `amz_amount_type.ilike.${pattern}`,
      `amz_amount_description.ilike.${pattern}`,
    ].join(",");
    params.set("or", `(${searchFilters})`);
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/no_sku_transactions_view?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: "count=exact",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`No-SKU query failed with HTTP ${response.status}`);
  }

  return {
    rows: (await response.json()) as NoSkuTransaction[],
    totalCount: parseTotalCount(response.headers.get("Content-Range")),
  };
}

function getCellClassName(column: ColumnDefinition): string | undefined {
  const classNames: string[] = [];

  if (column.align === "right") {
    classNames.push("numeric");
  }

  if (column.key === "amz_sku") {
    classNames.push("sku-cell");
  }

  if (column.key === "amz_order_id") {
    classNames.push("order-cell");
  }

  if (column.key === "net_amount") {
    classNames.push("strong-cell");
  }

  return classNames.length > 0 ? classNames.join(" ") : undefined;
}

function renderOrderCell(
  row: OrderTransaction,
  column: ColumnDefinition,
): string {
  if (column.kind === "date") {
    return formatDate(row.amz_posted_date_time);
  }

  if (column.kind === "integer") {
    return row.amz_quantity_purchased === null
      ? "-"
      : integerFormatter.format(row.amz_quantity_purchased);
  }

  if (column.kind === "money") {
    return formatMoney(row[column.key as AmountColumn], row.amz_currency);
  }

  const value = row[column.key as keyof OrderTransaction];
  return value === null ? "-" : String(value);
}

function renderNoSkuCell(
  row: NoSkuTransaction,
  column: ColumnDefinition,
): string {
  if (column.kind === "date") {
    return formatDate(row.amz_posted_date_time);
  }

  if (column.kind === "money") {
    return formatMoney(row[column.key as "amz_amount"], row.amz_currency);
  }

  const value = row[column.key as NoSkuColumn];
  return value === null ? "-" : String(value);
}

function App() {
  const [selectedAccount, setSelectedAccount] = useState<DemoAccount>(
    DEMO_ACCOUNTS[0],
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>("orders");
  const [session, setSession] = useState<Session | null>(null);
  const [orderRows, setOrderRows] = useState<OrderTransaction[]>([]);
  const [noSkuRows, setNoSkuRows] = useState<NoSkuTransaction[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  const [visibleAmountColumns, setVisibleAmountColumns] = useState<
    AmountColumn[]
  >(DEFAULT_VISIBLE_AMOUNT_COLUMNS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT_BY_TAB.orders);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalPages = useMemo(() => {
    if (totalCount === null || totalCount === 0) {
      return 1;
    }

    return Math.ceil(totalCount / pageSize);
  }, [pageSize, totalCount]);

  const currentStart = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const activeRowCount =
    activeTab === "orders" ? orderRows.length : noSkuRows.length;
  const currentEnd =
    totalCount === null
      ? pageIndex * pageSize + activeRowCount
      : Math.min(totalCount, pageIndex * pageSize + activeRowCount);
  const visibleColumns = useMemo(
    () =>
      activeTab === "orders"
        ? [
            ...FIXED_COLUMNS,
            ...AMOUNT_COLUMNS.filter((column) =>
              visibleAmountColumns.includes(column.key as AmountColumn),
            ),
          ]
        : NO_SKU_COLUMNS,
    [activeTab, visibleAmountColumns],
  );

  const loadSession = useCallback(async (account: DemoAccount) => {
    setIsSigningIn(true);
    setErrorMessage(null);

    try {
      const nextSession = await signIn(account);
      setSession(nextSession);
      setPageIndex(0);
    } catch (error) {
      setSession(null);
      setOrderRows([]);
      setNoSkuRows([]);
      setTotalCount(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    if (!session) {
      return;
    }

    setIsLoadingRows(true);
    setErrorMessage(null);

    try {
      const result =
        activeTab === "orders"
          ? await fetchOrderTransactions({
              accessToken: session.access_token,
              pageIndex,
              pageSize,
              search,
              sort,
            })
          : await fetchNoSkuTransactions({
              accessToken: session.access_token,
              pageIndex,
              pageSize,
              search,
              sort,
            });

      if (activeTab === "orders") {
        setOrderRows(result.rows as OrderTransaction[]);
      } else {
        setNoSkuRows(result.rows as NoSkuTransaction[]);
      }
      setTotalCount(result.totalCount);
    } catch (error) {
      if (activeTab === "orders") {
        setOrderRows([]);
      } else {
        setNoSkuRows([]);
      }
      setTotalCount(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoadingRows(false);
    }
  }, [activeTab, pageIndex, pageSize, search, session, sort]);

  useEffect(() => {
    void loadSession(selectedAccount);
  }, [loadSession, selectedAccount]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  function toggleSort(column: SortColumn): void {
    setPageIndex(0);
    setSort((currentSort) => {
      if (currentSort.column !== column) {
        return {
          column,
          direction: "asc",
        };
      }

      return {
        column,
        direction: currentSort.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function toggleAmountColumn(column: AmountColumn): void {
    setVisibleAmountColumns((currentColumns) => {
      const isVisible = currentColumns.includes(column);
      const nextColumns = isVisible
        ? currentColumns.filter((currentColumn) => currentColumn !== column)
        : [...currentColumns, column];

      if (isVisible && sort.column === column) {
        setSort({
          column: "amz_posted_date_time",
          direction: "desc",
        });
      }

      return nextColumns;
    });
  }

  function changeTab(tab: ActiveTab): void {
    setActiveTab(tab);
    setSearch("");
    setPageIndex(0);
    setTotalCount(null);
    setSort(DEFAULT_SORT_BY_TAB[tab]);
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <p className="eyebrow">SelBox POC</p>
          <h1>Transactions</h1>
        </div>

        <div className="account-switcher" aria-label="Account">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              className={
                account.email === selectedAccount.email ? "active" : undefined
              }
              key={account.email}
              onClick={() => setSelectedAccount(account)}
              type="button"
            >
              {account.label}
            </button>
          ))}
        </div>
      </header>

      <nav className="dataset-tabs" aria-label="Transaction tables">
        <button
          className={activeTab === "orders" ? "active" : undefined}
          onClick={() => changeTab("orders")}
          type="button"
        >
          Order Transactions
        </button>
        <button
          className={activeTab === "no_sku" ? "active" : undefined}
          onClick={() => changeTab("no_sku")}
          type="button"
        >
          No-SKU Transactions
        </button>
      </nav>

      <section className="summary-band" aria-live="polite">
        <div>
          <span className="metric-label">Rows</span>
          <strong>
            {totalCount === null ? "-" : integerFormatter.format(totalCount)}
          </strong>
        </div>
        <div>
          <span className="metric-label">Table</span>
          <strong>
            {activeTab === "orders"
              ? "Order Transactions"
              : "No-SKU Transactions"}
          </strong>
        </div>
        <div>
          <span className="metric-label">Signed In</span>
          <strong>{session?.user.email ?? selectedAccount.email}</strong>
        </div>
        <div>
          <span className="metric-label">Page</span>
          <strong>
            {pageIndex + 1} / {totalPages}
          </strong>
        </div>
      </section>

      <section className="table-tools">
        <label className="search-field">
          <span>Search</span>
          <input
            onChange={(event) => {
              setSearch(event.target.value);
              setPageIndex(0);
            }}
            placeholder={
              activeTab === "orders"
                ? "Order, SKU, market, company"
                : "Order, SKU, transaction, amount, company"
            }
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

        {activeTab === "orders" ? (
          <fieldset className="columns-field">
            <legend>Amount Columns</legend>
            <div>
              {AMOUNT_COLUMNS.map((column) => {
                const amountColumn = column.key as AmountColumn;

                return (
                  <label key={amountColumn}>
                    <input
                      checked={visibleAmountColumns.includes(amountColumn)}
                      onChange={() => toggleAmountColumn(amountColumn)}
                      type="checkbox"
                    />
                    <span>{column.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <button
          className="secondary-button"
          disabled={!session || isLoadingRows || isSigningIn}
          onClick={() => void loadTransactions()}
          type="button"
        >
          Refresh
        </button>
      </section>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <section className="table-frame" aria-busy={isLoadingRows || isSigningIn}>
        <div className="table-scroll">
          <table
            style={{
              minWidth: `${Math.max(1080, visibleColumns.length * 124)}px`,
            }}
          >
            <thead>
              <tr>
                {visibleColumns.map((column) => {
                  const sortableColumn = column.sortable;

                  return (
                    <th
                      className={
                        column.align === "right" ? "numeric" : undefined
                      }
                      key={column.key}
                      scope="col"
                    >
                      {sortableColumn ? (
                        <button
                          aria-label={`Sort by ${column.label}`}
                          className="sort-button"
                          onClick={() => toggleSort(sortableColumn)}
                          type="button"
                        >
                          {column.label}
                          <span aria-hidden="true">
                            {sort.column === sortableColumn
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
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {activeTab === "orders"
                ? orderRows.map((row) => (
                    <tr key={row.id}>
                      {visibleColumns.map((column) => (
                        <td
                          className={getCellClassName(column)}
                          key={column.key}
                        >
                          {renderOrderCell(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))
                : noSkuRows.map((row) => (
                    <tr key={row.id}>
                      {visibleColumns.map((column) => (
                        <td
                          className={getCellClassName(column)}
                          key={column.key}
                        >
                          {renderNoSkuCell(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {activeRowCount === 0 && !isLoadingRows && !isSigningIn ? (
          <div className="empty-state">No matching transactions</div>
        ) : null}

        {isLoadingRows || isSigningIn ? (
          <div className="loading-state">Loading transactions</div>
        ) : null}
      </section>

      <footer className="pagination-bar">
        <span>
          {integerFormatter.format(currentStart)}-
          {integerFormatter.format(currentEnd)} of{" "}
          {totalCount === null ? "-" : integerFormatter.format(totalCount)}
        </span>

        <div className="pagination-actions">
          <button
            disabled={pageIndex === 0 || isLoadingRows || isSigningIn}
            onClick={() => setPageIndex((currentPage) => currentPage - 1)}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={
              isLoadingRows ||
              isSigningIn ||
              totalCount === null ||
              pageIndex >= totalPages - 1
            }
            onClick={() => setPageIndex((currentPage) => currentPage + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>
    </main>
  );
}

export default App;
