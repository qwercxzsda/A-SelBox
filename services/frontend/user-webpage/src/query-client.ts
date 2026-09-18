import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api/client.ts";

/** Each authenticated workspace owns its cache and discards it when access changes. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // The workspace validates account access before these lifecycle refreshes.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (failureCount, error) =>
          failureCount < 1 &&
          error instanceof ApiError &&
          (error.status === null || error.status >= 500),
      },
    },
  });
}
