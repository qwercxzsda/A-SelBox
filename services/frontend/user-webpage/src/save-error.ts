import { loadErrorDetail } from "./load-error.ts";

/** Every failed change names itself in one form: "save the assignment", "add the company". */
type FailedChange = `${"save" | "add" | "delete"} the ${string}`;

/**
 * A failed change, worded like a failed read: the title names the change ("Could not save the
 * assignment"), the detail gives a known reason or the cause as `loadErrorDetail` words it.
 */
export interface SaveError {
  title: string;
  detail: string;
}

export function saveError(change: FailedChange, error: unknown, reason?: string): SaveError {
  return { title: `Could not ${change}`, detail: reason ?? loadErrorDetail(error) };
}

/** The same failure on one line, where it is shown as text: "Could not save the assignment. …" */
export function saveErrorText({ title, detail }: SaveError): string {
  return `${title}. ${detail}`;
}
