export type LoadingState = "loading" | "updating" | null;

/** Quiet progress beside a heading, without a spinner or an extra layout row. */
export function LoadingStatus({ state }: { state?: LoadingState }) {
  return (
    <span className="heading-status" role="status" aria-live="polite" aria-atomic="true">
      {state === "loading" ? "Loading…" : state === "updating" ? "Updating…" : ""}
    </span>
  );
}
