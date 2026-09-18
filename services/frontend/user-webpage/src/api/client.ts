import { DATASET_CONFIG } from "./config.ts";
import { parseTotalCount } from "./content-range.ts";
import { parseCsv } from "./csv.ts";
import { mapDatasetRows } from "./row-mappers.ts";
import { readBuildConfig, validateApiConfig, type ApiClientConfig } from "./runtime-config.ts";
import { buildSearchFilter } from "./search.ts";
import type {
  AppAccount,
  Company,
  DatasetKey,
  DatasetSort,
  FetchDatasetPageOptions,
  PageResult,
  Session,
  SkuAssignment,
} from "./types.ts";
import {
  isJsonObject,
  optionalJsonNumber,
  optionalJsonString,
  requiredJsonNumber,
  requiredJsonString,
} from "./validation.ts";

export type { ApiClientConfig } from "./runtime-config.ts";

const LOOKUP_PAGE_SIZE = 1000;
const SORT_DIRECTIONS: ReadonlySet<string> = new Set(["asc", "desc"]);

/** A null status identifies a transport failure; server response bodies stay private. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(operation: string, status: number | null) {
    super(
      status === null
        ? `${operation} failed because the network request failed`
        : `${operation} failed with HTTP ${String(status)}`,
    );
    this.name = "ApiError";
    this.status = status;
  }
}

function requireAccessToken(accessToken: string): void {
  if (accessToken.trim().length === 0) throw new Error("An access token is required");
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

function parseSession(value: unknown, operation: string): Session {
  if (!isJsonObject(value) || !isJsonObject(value.user)) {
    throw new Error(`${operation} returned an invalid session`);
  }
  return {
    access_token: requiredJsonString(value, "access_token"),
    token_type: requiredJsonString(value, "token_type"),
    expires_in: requiredJsonNumber(value, "expires_in"),
    expires_at: optionalJsonNumber(value, "expires_at"),
    refresh_token: requiredJsonString(value, "refresh_token"),
    user: {
      id: requiredJsonString(value.user, "id"),
      email: optionalJsonString(value.user, "email"),
    },
  };
}

function parseObjectRows(value: unknown, operation: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw new Error(`${operation} returned invalid rows`);
  }
  return value;
}

function parseAppAccount(value: Record<string, unknown>, userId: string): AppAccount {
  const user_id = requiredJsonString(value, "user_id");
  const access_role = requiredJsonString(value, "access_role");
  const company_id = value.company_id === null ? null : requiredJsonString(value, "company_id");
  if (
    user_id !== userId ||
    (access_role !== "operator" && access_role !== "company_member") ||
    (access_role === "operator" ? company_id !== null : company_id === null)
  ) {
    throw new Error("Application account query returned an invalid account");
  }
  return { user_id, access_role, company_id };
}

function validatePageRequest(
  dataset: DatasetKey,
  pageIndex: number,
  pageSize: number,
  sort: DatasetSort,
): void {
  if (!Object.hasOwn(DATASET_CONFIG, dataset)) throw new Error("Dataset is invalid");
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("Page index must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > LOOKUP_PAGE_SIZE) {
    throw new Error("Page size must be a positive integer of at most 1000");
  }
  if (!SORT_DIRECTIONS.has(sort.direction)) throw new Error("Sort direction is invalid");
  if (!DATASET_CONFIG[dataset].sortColumns.some((column) => column === sort.column)) {
    throw new Error(`Sort column is not allowed for ${dataset}`);
  }
  if (!Number.isSafeInteger(pageIndex * pageSize)) {
    throw new Error("Page offset exceeds JavaScript's safe range");
  }
}

function buildDatasetParams(options: FetchDatasetPageOptions): URLSearchParams {
  const { dataset, pageIndex, pageSize, search, sort } = options;
  const config = DATASET_CONFIG[dataset];
  const order = [
    `${sort.column}.${sort.direction}.nullslast`,
    ...config.idColumns.filter((column) => column !== sort.column).map((column) => `${column}.asc`),
  ];
  const params = new URLSearchParams({
    select: config.selectColumns.join(","),
    limit: String(pageSize),
    offset: String(pageIndex * pageSize),
    order: order.join(","),
  });
  const filter = buildSearchFilter(config.searchColumns, search);
  if (filter !== null) params.set("or", filter);
  return params;
}

/** Bind requests to one public Supabase configuration; injectable fetch keeps tests offline. */
export function createApiClient(
  configuration: ApiClientConfig,
  fetchImplementation: typeof fetch = globalThis.fetch,
) {
  const { supabaseUrl, publishableKey } = validateApiConfig(configuration);

  async function request(path: string, init: RequestInit, operation: string): Promise<Response> {
    try {
      return await fetchImplementation(`${supabaseUrl}${path}`, { ...init, redirect: "error" });
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      throw new ApiError(operation, null);
    }
  }

  function authenticatedHeaders(accessToken: string, accept = "application/json") {
    requireAccessToken(accessToken);
    return { Accept: accept, Authorization: `Bearer ${accessToken}`, apikey: publishableKey };
  }

  async function requestSession(
    grantType: "password" | "refresh_token",
    credentials: Record<string, string>,
    operation: string,
  ): Promise<Session> {
    const response = await request(
      `/auth/v1/token?grant_type=${grantType}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: publishableKey },
        body: JSON.stringify(credentials),
      },
      operation,
    );
    if (!response.ok) throw new ApiError(operation, response.status);
    return parseSession(await readJson(response, operation), operation);
  }

  async function readAllRows(
    accessToken: string,
    endpoint: string,
    select: string,
    order: string,
    operation: string,
  ): Promise<Record<string, unknown>[]> {
    const headers = { ...authenticatedHeaders(accessToken), Prefer: "count=exact" };
    const rows: Record<string, unknown>[] = [];
    for (;;) {
      const params = new URLSearchParams({
        select,
        order,
        limit: String(LOOKUP_PAGE_SIZE),
        offset: String(rows.length),
      });
      const response = await request(
        `/rest/v1/${endpoint}?${params.toString()}`,
        { headers },
        operation,
      );
      if (response.status === 416) {
        const total = parseTotalCount(response.headers.get("Content-Range"));
        if (total !== null && rows.length >= total) return rows;
      }
      if (!response.ok) throw new ApiError(operation, response.status);
      const page = parseObjectRows(await readJson(response, operation), operation);
      const total = parseTotalCount(response.headers.get("Content-Range"));
      rows.push(...page);
      if (total !== null && rows.length >= total) return rows;
      if (page.length === 0) {
        if (total !== null) throw new Error(`${operation} returned an incomplete page`);
        return rows;
      }
    }
  }

  return {
    signIn(email: string, password: string): Promise<Session> {
      return requestSession("password", { email, password }, "Sign in");
    },

    refreshSession(refreshToken: string): Promise<Session> {
      if (refreshToken.trim().length === 0) throw new Error("A refresh token is required");
      return requestSession("refresh_token", { refresh_token: refreshToken }, "Session refresh");
    },

    async signOut(accessToken: string): Promise<void> {
      const response = await request(
        "/auth/v1/logout?scope=local",
        { method: "POST", headers: authenticatedHeaders(accessToken) },
        "Sign out",
      );
      if (!response.ok) throw new ApiError("Sign out", response.status);
    },

    async fetchAppAccount(accessToken: string, userId: string): Promise<AppAccount> {
      if (userId.trim() === "") throw new Error("An Auth user ID is required");
      const params = new URLSearchParams({
        select: "user_id,access_role,company_id",
        user_id: `eq.${userId}`,
        limit: "1",
      });
      const operation = "Application account query";
      const response = await request(
        `/rest/v1/app_accounts?${params.toString()}`,
        { headers: authenticatedHeaders(accessToken) },
        operation,
      );
      if (!response.ok) throw new ApiError(operation, response.status);
      const rows = parseObjectRows(await readJson(response, operation), operation);
      if (rows.length === 0) throw new Error("This Auth account has no application access");
      if (rows.length !== 1) throw new Error(`${operation} returned multiple accounts`);
      return parseAppAccount(rows[0], userId);
    },

    async fetchCompanies(accessToken: string): Promise<Company[]> {
      const rows = await readAllRows(
        accessToken,
        "companies",
        "id,name",
        "name.asc,id.asc",
        "Company query",
      );
      return rows.map((row) => ({
        id: requiredJsonString(row, "id"),
        name: requiredJsonString(row, "name"),
      }));
    },

    async fetchSkuAssignments(accessToken: string): Promise<SkuAssignment[]> {
      const rows = await readAllRows(
        accessToken,
        "company_skus",
        "id,seller_namespace,sku,company_id,terms_version_id",
        "id.asc",
        "SKU assignment query",
      );
      return rows.map((row) => ({
        id: requiredJsonString(row, "id"),
        seller_namespace: requiredJsonString(row, "seller_namespace"),
        sku: requiredJsonString(row, "sku"),
        company_id: requiredJsonString(row, "company_id"),
        terms_version_id: requiredJsonString(row, "terms_version_id"),
      }));
    },

    async fetchDatasetPage(options: FetchDatasetPageOptions): Promise<PageResult> {
      requireAccessToken(options.accessToken);
      validatePageRequest(options.dataset, options.pageIndex, options.pageSize, options.sort);
      const config = DATASET_CONFIG[options.dataset];
      const params = buildDatasetParams(options);
      const response = await request(
        `/rest/v1/${config.endpoint}?${params.toString()}`,
        {
          signal: options.signal,
          headers: {
            ...authenticatedHeaders(options.accessToken, "text/csv"),
            Prefer: "count=exact",
          },
        },
        `${config.label} query`,
      );
      if (!response.ok) {
        if (response.status === 416) {
          const totalCount = parseTotalCount(response.headers.get("Content-Range"));
          if (totalCount !== null) return { rows: [], totalCount };
        }
        throw new ApiError(`${config.label} query`, response.status);
      }
      return {
        rows: mapDatasetRows(options.dataset, parseCsv(await response.text())),
        totalCount: parseTotalCount(response.headers.get("Content-Range")),
      };
    },
  };
}

let defaultClient: ReturnType<typeof createApiClient> | undefined;
function getDefaultClient(): ReturnType<typeof createApiClient> {
  defaultClient ??= createApiClient(readBuildConfig());
  return defaultClient;
}

export const signIn = (email: string, password: string): Promise<Session> =>
  getDefaultClient().signIn(email, password);
export const refreshSession = (refreshToken: string): Promise<Session> =>
  getDefaultClient().refreshSession(refreshToken);
export const signOut = (accessToken: string): Promise<void> =>
  getDefaultClient().signOut(accessToken);
export const fetchAppAccount = (accessToken: string, userId: string): Promise<AppAccount> =>
  getDefaultClient().fetchAppAccount(accessToken, userId);
export const fetchCompanies = (accessToken: string): Promise<Company[]> =>
  getDefaultClient().fetchCompanies(accessToken);
export const fetchSkuAssignments = (accessToken: string): Promise<SkuAssignment[]> =>
  getDefaultClient().fetchSkuAssignments(accessToken);
export const fetchDatasetPage = (options: FetchDatasetPageOptions): Promise<PageResult> =>
  getDefaultClient().fetchDatasetPage(options);
