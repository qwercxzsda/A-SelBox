import type { AppAccount } from "./api/types.ts";

export type WorkspaceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const MAX_VALUE_LENGTH = 2_000_000;

export function workspaceStoragePrefix(supabaseUrl: string): string {
  return `aselbox.workspace.v1:${supabaseUrl.replace(/\/+$/, "")}:`;
}

export function clearWorkspaceStorage(storage: WorkspaceStorage | null, prefix: string): void {
  try {
    const keys = Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index));
    for (const key of keys) if (key?.startsWith(prefix)) storage?.removeItem(key);
  } catch {
    // Storage restrictions must not prevent sign-out or ordinary navigation.
  }
}

export function createWorkspaceStore(
  storage: WorkspaceStorage | null,
  prefix: string,
  account: AppAccount,
) {
  const scope = JSON.stringify([account.user_id, account.access_role, account.company_id]);
  const activeKey = `${prefix}active`;
  let activeToken = "";
  try {
    const saved = storage?.getItem(activeKey);
    let previous: unknown = null;
    try {
      previous = saved ? JSON.parse(saved) : null;
    } catch {
      // A malformed scope marker discards old views without disabling healthy storage.
    }
    if (Array.isArray(previous) && previous[0] === scope && typeof previous[1] === "string")
      activeToken = saved ?? "";
    else {
      clearWorkspaceStorage(storage, prefix);
      activeToken = JSON.stringify([scope, `${String(Date.now())}:${String(Math.random())}`]);
    }
    storage?.setItem(activeKey, activeToken);
  } catch {
    storage = null;
  }
  const memory = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let persistenceFailed = storage === null;
  function reportPersistenceFailure() {
    if (persistenceFailed) return;
    persistenceFailed = true;
    for (const listener of listeners) listener();
  }
  let suspended = false;
  const keyFor = (name: string) => `${prefix}${scope}:${name}`;
  return {
    getPersistenceFailed: () => persistenceFailed,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSuspended(value: boolean) {
      suspended = value;
    },
    read<T>(name: string, createDefault: () => T, decode: (value: unknown) => T): T {
      let raw: string | null | undefined;
      try {
        raw = storage?.getItem(keyFor(name));
      } catch {
        reportPersistenceFailure();
      }
      try {
        if (memory.has(name)) return decode(memory.get(name));
        if (raw && raw.length <= MAX_VALUE_LENGTH) return decode(JSON.parse(raw) as unknown);
      } catch {
        // Malformed or obsolete stored values are not evidence of a storage failure.
      }
      return createDefault();
    },
    write(name: string, value: unknown): void {
      if (suspended) return;
      memory.set(name, value);
      try {
        // An unmounted workspace's late network callbacks cannot resurrect signed-out state.
        if (storage?.getItem(activeKey) !== activeToken) return;
        const raw = JSON.stringify(value);
        if (raw.length <= MAX_VALUE_LENGTH) storage.setItem(keyFor(name), raw);
        else {
          reportPersistenceFailure();
          storage.removeItem(keyFor(name));
        }
      } catch {
        // Keep the in-memory workspace usable when storage is full or disabled.
        reportPersistenceFailure();
      }
    },
  };
}
