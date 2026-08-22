import { DATASET_CONFIG } from "./config.ts";
import { parseTotalCount } from "./content-range.ts";
import { parseCsv } from "./csv.ts";
import { mapDatasetRows } from "./row-mappers.ts";
import { sanitizeSearchTerm } from "./search.ts";
import type {
  Company,
  DatasetKey,
  DatasetRowMap,
  DatasetSort,
  FetchDatasetPageOptions,
  PageResult,
  Session,
} from "./types.ts";
import {
  isJsonObject,
  optionalJsonNumber,
  optionalJsonString,
  requiredJsonNumber,
  requiredJsonString,
} from "./validation.ts";

const RUNTIME_LOCATION: unknown = globalThis.location;
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SORT_DIRECTIONS: ReadonlySet<string> = new Set(["asc", "desc"]);

function optionalBuildString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultSupabaseUrl(): string {
  if (isJsonObject(RUNTIME_LOCATION) && RUNTIME_LOCATION.hostname === "host.docker.internal") {
    return "http://host.docker.internal:54321";
  }
  return "http://127.0.0.1:54321";
}

function missingBuildSetting(name: string): never {
  throw new Error(`${name} must be configured outside the Vite development server`);
}

const SUPABASE_URL = (
  optionalBuildString(import.meta.env.VITE_SUPABASE_URL) ??
  (import.meta.env.DEV ? defaultSupabaseUrl() : missingBuildSetting("VITE_SUPABASE_URL"))
).replace(/\/+$/, "");
const SUPABASE_PUBLISHABLE_KEY =
  optionalBuildString(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ??
  (import.meta.env.DEV
    ? LOCAL_PUBLISHABLE_KEY
    : missingBuildSetting("VITE_SUPABASE_PUBLISHABLE_KEY"));

function requireAccessToken(accessToken: string): void {
  if (accessToken.length === 0) {
    throw new Error("An access token is required");
  }
}

async function safeFetch(url: string, init: RequestInit, operation: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`${operation} failed because the network request failed`);
  }
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

function parseCompanies(value: unknown): Company[] {
  if (!Array.isArray(value)) {
    throw new Error("Company query returned an invalid response");
  }

  return value.map((company) => {
    if (!isJsonObject(company)) {
      throw new Error("Company query returned an invalid row");
    }
    return {
      id: requiredJsonString(company, "id"),
      company_name: requiredJsonString(company, "company_name"),
    };
  });
}

function validatePageRequest(
  dataset: DatasetKey,
  pageIndex: number,
  pageSize: number,
  sort: DatasetSort,
): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("Page index must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error("Page size must be a positive safe integer");
  }
  if (!SORT_DIRECTIONS.has(sort.direction)) {
    throw new Error("Sort direction is invalid");
  }
  if (!DATASET_CONFIG[dataset].sortColumns.some((allowedColumn) => allowedColumn === sort.column)) {
    throw new Error(`Sort column is not allowed for ${dataset}`);
  }

  const offset = pageIndex * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Page offset exceeds JavaScript's safe range");
  }
}

function buildDatasetParams(
  dataset: DatasetKey,
  pageIndex: number,
  pageSize: number,
  search: string,
  sort: DatasetSort,
): URLSearchParams {
  const config = DATASET_CONFIG[dataset];
  const params = new URLSearchParams();
  params.set("select", config.selectColumns.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String(pageIndex * pageSize));

  const tieBreaker = sort.column === "id" ? "" : ",id.asc";
  params.set("order", `${sort.column}.${sort.direction}.nullslast${tieBreaker}`);

  const searchTerm = sanitizeSearchTerm(search);
  if (searchTerm.length > 0) {
    const pattern = `*${searchTerm}*`;
    const filters = config.searchColumns.map((column) => `${column}.ilike.${pattern}`);
    params.set("or", `(${filters.join(",")})`);
  }

  return params;
}

async function requestSession(
  grantType: "password" | "refresh_token",
  credentials: Record<string, string>,
  operation: string,
): Promise<Session> {
  const response = await safeFetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(credentials),
    },
    operation,
  );

  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${String(response.status)}`);
  }
  return parseSession(await readJson(response, operation), operation);
}

export async function signIn(email: string, password: string): Promise<Session> {
  return requestSession("password", { email, password }, "Sign in");
}

export async function refreshSession(refreshToken: string): Promise<Session> {
  if (refreshToken.length === 0) {
    throw new Error("A refresh token is required");
  }
  return requestSession("refresh_token", { refresh_token: refreshToken }, "Session refresh");
}

export async function signOut(accessToken: string): Promise<void> {
  requireAccessToken(accessToken);
  const response = await safeFetch(
    `${SUPABASE_URL}/auth/v1/logout`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    },
    "Sign out",
  );

  if (!response.ok) {
    throw new Error(`Sign out failed with HTTP ${String(response.status)}`);
  }
}

export async function fetchCompanies(accessToken: string): Promise<Company[]> {
  requireAccessToken(accessToken);
  const params = new URLSearchParams({
    select: "id,company_name",
    order: "company_name.asc,id.asc",
  });
  const response = await safeFetch(
    `${SUPABASE_URL}/rest/v1/companies?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    },
    "Company query",
  );

  if (!response.ok) {
    throw new Error(`Company query failed with HTTP ${String(response.status)}`);
  }
  return parseCompanies(await readJson(response, "Company query"));
}

export async function fetchDatasetPage<Dataset extends DatasetKey>({
  accessToken,
  dataset,
  pageIndex,
  pageSize,
  search,
  sort,
}: FetchDatasetPageOptions<Dataset>): Promise<PageResult<DatasetRowMap[Dataset]>> {
  requireAccessToken(accessToken);
  validatePageRequest(dataset, pageIndex, pageSize, sort);

  const config = DATASET_CONFIG[dataset];
  const params = buildDatasetParams(dataset, pageIndex, pageSize, search, sort);
  const response = await safeFetch(
    `${SUPABASE_URL}/rest/v1/${config.endpoint}?${params.toString()}`,
    {
      headers: {
        Accept: "text/csv",
        Authorization: `Bearer ${accessToken}`,
        Prefer: "count=exact",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    },
    `${config.label} query`,
  );

  if (!response.ok) {
    if (response.status === 416) {
      const totalCount = parseTotalCount(response.headers.get("Content-Range"));
      if (totalCount !== null) {
        return { rows: [], totalCount };
      }
    }
    throw new Error(`${config.label} query failed with HTTP ${String(response.status)}`);
  }

  return {
    rows: mapDatasetRows(dataset, parseCsv(await response.text())),
    totalCount: parseTotalCount(response.headers.get("Content-Range")),
  };
}
