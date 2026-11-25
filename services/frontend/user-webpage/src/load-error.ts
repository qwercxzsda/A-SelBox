import { ApiError } from "./api/transport.ts";

/**
 * The short cause of a failed read, shown beneath the title "Could not load <subject>" and so
 * never repeating the subject: the HTTP status, a missing response or a timeout, or any other
 * error's own sentence.
 */
export function loadErrorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.timedOut) return "The request timed out.";
    return error.status === null
      ? "No response from the server."
      : `The server returned HTTP ${String(error.status)}.`;
  }
  const detail = error instanceof Error ? error.message.trim() : "";
  if (!detail) return "Unexpected request failure.";
  return /[.!?]$/.test(detail) ? detail : `${detail}.`;
}
