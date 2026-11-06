import { createContext, useContext, useEffect, useRef } from "react";
import type { Identity } from "./auth-session";
import type { SourceTotals } from "./api/source-totals";

export const SourceDiagnosticsContext = createContext<{
  identity: Identity;
  refresh: () => Promise<void>;
} | null>(null);

export function useDiagnosticsIdentity(): Identity {
  const context = useContext(SourceDiagnosticsContext);
  if (!context) throw new Error("Source diagnostics require an authenticated workspace");
  return context.identity;
}

interface DiagnosticQuery {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
}

/** A comparison needs every input; a failed coverage read is never an empty result. */
export function diagnosticQueryState(
  queries: readonly DiagnosticQuery[],
  compatible: boolean,
): DiagnosticQuery {
  const isError = queries.some((query) => query.isError);
  return {
    isPending: !isError && (!compatible || queries.some((query) => query.isPending)),
    isFetching: queries.some((query) => query.isFetching),
    isError,
    isSuccess: compatible && queries.every((query) => query.isSuccess),
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

/** Discard mixed-revision comparisons and refresh the workspace's dependent reads together. */
export function useSourceRevisionGuard(
  result: Pick<SourceTotals, "revision"> | undefined,
): boolean {
  const context = useContext(SourceDiagnosticsContext);
  if (!context) throw new Error("Source diagnostics require an authenticated workspace");
  const { identity, refresh } = context;
  const mismatch =
    result?.revision !== null &&
    result?.revision !== undefined &&
    (result.revision.finances !== identity.revisions.finances ||
      result.revision.data_kiosk !== identity.revisions.data_kiosk);
  const signature = mismatch ? JSON.stringify(result.revision) : "";
  const pending = useRef("");
  useEffect(() => {
    if (!signature) {
      pending.current = "";
      return;
    }
    if (pending.current === signature) return;
    pending.current = signature;
    void refresh();
  }, [signature, refresh]);
  return !mismatch;
}
