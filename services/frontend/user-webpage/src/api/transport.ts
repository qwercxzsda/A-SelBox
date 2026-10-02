import { parseTotalCount } from "./content-range.ts";
import { parseCsv } from "./csv.ts";
import { validateApiConfig, type ApiClientConfig } from "./client-config.ts";
import type { PageResult } from "./types.ts";
import { publicRpcError } from "./rpc-errors.ts";

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

export function requireAccessToken(accessToken: string): void {
  if (accessToken.trim().length === 0) throw new Error("An access token is required");
}

async function readText(
  response: Response,
  operation: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new ApiError(operation, null);
  }
}

export async function readJson(
  response: Response,
  operation: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = await readText(response, operation, signal);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

export function createTransport(configuration: ApiClientConfig, fetchImplementation: typeof fetch) {
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

  async function readCsvPage(
    accessToken: string,
    endpoint: string,
    params: URLSearchParams,
    operation: string,
    signal?: AbortSignal,
    includeCount = true,
  ): Promise<PageResult> {
    const response = await request(
      `/rest/v1/${endpoint}?${params.toString()}`,
      {
        signal,
        headers: {
          ...authenticatedHeaders(accessToken, "text/csv"),
          ...(includeCount ? { Prefer: "count=exact" } : {}),
        },
      },
      operation,
    );
    if (!response.ok) {
      if (response.status === 416) {
        const totalCount = parseTotalCount(response.headers.get("Content-Range"));
        if (totalCount !== null) return { rows: [], totalCount };
      }
      throw new ApiError(operation, response.status);
    }
    return {
      rows: parseCsv(await readText(response, operation, signal)),
      totalCount: parseTotalCount(response.headers.get("Content-Range")),
    };
  }

  async function requestJson(path: string, init: RequestInit, operation: string): Promise<unknown> {
    const response = await request(path, init, operation);
    if (!response.ok) throw new ApiError(operation, response.status);
    return readJson(response, operation, init.signal ?? undefined);
  }

  async function postRpc(
    accessToken: string,
    name: string,
    args: object,
    operation: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await request(
      `/rest/v1/rpc/${name}`,
      {
        method: "POST",
        signal,
        headers: { ...authenticatedHeaders(accessToken), "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
      operation,
    );
    if (!response.ok) {
      if (
        response.status === 400 ||
        (response.status === 409 && name === "publish_sku_configuration")
      ) {
        const body = await readJson(response, operation, signal).catch((error: unknown) => {
          if (signal?.aborted || (error instanceof Error && error.name === "AbortError"))
            throw error;
          return null;
        });
        const publicError = publicRpcError(name, args, body);
        if (publicError) throw publicError;
      }
      throw new ApiError(operation, response.status);
    }
    return readJson(response, operation, signal);
  }

  return { request, requestJson, postRpc, authenticatedHeaders, readCsvPage, publishableKey };
}
export type ApiTransport = ReturnType<typeof createTransport>;
