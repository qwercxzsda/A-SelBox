import { sameAccount } from "../workspace-revisions.ts";
import { ApiError, type ApiTransport } from "./transport.ts";
import type { AppAccount, RevisionSource } from "./types.ts";
import { readWorkspaceRevisions } from "./workspace.ts";

/** Reject a complete paged read if publication or caller scope changes while it loads. */
export async function readStableSnapshot<T>(
  transport: ApiTransport,
  options: {
    accessToken: string;
    sources: readonly RevisionSource[];
    operation: string;
    expectedAccount?: AppAccount;
    signal?: AbortSignal;
  },
  read: () => Promise<T>,
): Promise<T> {
  const { operation, sources, signal } = options;
  signal?.throwIfAborted();
  const before = await readWorkspaceRevisions(transport, options);
  if (
    before.account.access_role === "unassigned" ||
    (options.expectedAccount && !sameAccount(before.account, options.expectedAccount))
  )
    throw new ApiError(`${operation} access`, 403);
  const value = await read();
  signal?.throwIfAborted();
  const after = await readWorkspaceRevisions(transport, options);
  if (!sameAccount(before.account, after.account)) throw new ApiError(`${operation} access`, 403);
  if (sources.some((source) => before.revisions[source] !== after.revisions[source]))
    throw new Error(`${operation} changed while loading.`);
  return value;
}
