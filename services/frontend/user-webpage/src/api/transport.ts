import { parseTotalCount } from "./content-range.ts";
import { parseCsv } from "./csv.ts";
import { validateApiConfig, type ApiClientConfig } from "./client-config.ts";
import type { PageResult } from "./types.ts";
import { publicRpcError } from "./rpc-errors.ts";
import {
  RequestTimeoutError,
  withRequestDeadline,
  REQUEST_TIMEOUT_MS,
} from "./request-deadline.ts";

/** A null status identifies a transport failure; server response bodies stay private. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(operation: string, status: number | null, timedOut = false) {
    super(
      timedOut
        ? `${operation} timed out. Please try again.`
        : status === null
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

export function createTransport(
  configuration: ApiClientConfig,
  fetchImplementation: typeof fetch,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
) {
  const { supabaseUrl, publishableKey } = validateApiConfig(configuration);
  async function request<T>(
    path: string,
    init: RequestInit,
    operation: string,
    consume: (response: Response, signal: AbortSignal) => Promise<T> | T,
  ): Promise<T> {
    try {
      return await withRequestDeadline(
        async (signal) => {
          let response: Response;
          try {
            response = await fetchImplementation(`${supabaseUrl}${path}`, {
              ...init,
              signal,
              redirect: "error",
            });
          } catch (error) {
            if (signal.aborted || (error instanceof Error && error.name === "AbortError"))
              throw error;
            throw new ApiError(operation, null);
          }
          try {
            signal.throwIfAborted();
            return await consume(response, signal);
          } finally {
            // HEAD/logout/error callers may need only headers; stop any unused download.
            if (!response.bodyUsed)
              void response.body?.cancel().catch(() => {
                // Cleanup must not replace the request's result or public error.
              });
          }
        },
        init.signal,
        requestTimeoutMs,
      );
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (error instanceof RequestTimeoutError) throw new ApiError(operation, null, true);
      throw error;
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
    return request(
      `/rest/v1/${endpoint}?${params.toString()}`,
      {
        signal,
        headers: {
          ...authenticatedHeaders(accessToken, "text/csv"),
          ...(includeCount ? { Prefer: "count=exact" } : {}),
        },
      },
      operation,
      async (response, requestSignal) => {
        if (!response.ok) {
          if (response.status === 416) {
            const totalCount = parseTotalCount(response.headers.get("Content-Range"));
            if (totalCount !== null) return { rows: [], totalCount };
          }
          throw new ApiError(operation, response.status);
        }
        return {
          rows: parseCsv(await readText(response, operation, requestSignal)),
          totalCount: parseTotalCount(response.headers.get("Content-Range")),
        };
      },
    );
  }

  async function requestJson(path: string, init: RequestInit, operation: string): Promise<unknown> {
    return request(path, init, operation, (response, signal) => {
      if (!response.ok) throw new ApiError(operation, response.status);
      return readJson(response, operation, signal);
    });
  }

  async function postRpc(
    accessToken: string,
    name: string,
    args: object,
    operation: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return request(
      `/rest/v1/rpc/${name}`,
      {
        method: "POST",
        signal,
        headers: { ...authenticatedHeaders(accessToken), "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
      operation,
      async (response, requestSignal) => {
        if (!response.ok) {
          if (
            (response.status === 400 && name !== "delete_company") ||
            (response.status === 409 &&
              ["publish_sku_configuration", "delete_company"].includes(name))
          ) {
            const body = await readJson(response, operation, requestSignal).catch(
              (error: unknown) => {
                if (
                  requestSignal.aborted ||
                  (error instanceof Error && error.name === "AbortError")
                )
                  throw error;
                return null;
              },
            );
            const publicError = publicRpcError(name, args, body);
            if (publicError) throw publicError;
          }
          throw new ApiError(operation, response.status);
        }
        return readJson(response, operation, requestSignal);
      },
    );
  }

  return { request, requestJson, postRpc, authenticatedHeaders, readCsvPage, publishableKey };
}
export type ApiTransport = ReturnType<typeof createTransport>;
