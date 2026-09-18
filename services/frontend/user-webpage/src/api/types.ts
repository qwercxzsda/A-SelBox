export type DatasetKey = "live" | "settlement" | "data_kiosk" | "fees" | "payouts" | "accounts";
export type SortDirection = "asc" | "desc";
export type DecimalString = string;

export interface SessionUser {
  id: string;
  email?: string;
}

export interface Session {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  refresh_token: string;
  user: SessionUser;
}

export interface Company {
  id: string;
  name: string;
}

export interface AppAccount {
  user_id: string;
  access_role: "operator" | "company_member";
  company_id: string | null;
}

export interface SkuAssignment {
  id: string;
  seller_namespace: string;
  sku: string;
  company_id: string;
  terms_version_id: string;
}

// CSV keeps PostgreSQL numerics exact and distinguishes SQL NULL from empty text.
export type CanonicalRow = Record<string, string | null>;
export type DatasetRowMap = Record<DatasetKey, CanonicalRow>;

export interface PageResult<Row extends CanonicalRow = CanonicalRow> {
  rows: Row[];
  totalCount: number | null;
}

export interface DatasetSort {
  column: string;
  direction: SortDirection;
}

export interface FetchDatasetPageOptions<Dataset extends DatasetKey = DatasetKey> {
  accessToken: string;
  signal?: AbortSignal;
  dataset: Dataset;
  pageIndex: number;
  pageSize: number;
  search: string;
  sort: DatasetSort;
}
