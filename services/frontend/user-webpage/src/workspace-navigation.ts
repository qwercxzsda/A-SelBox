import type { AppAccount } from "./api/types";
import type { createWorkspaceStore } from "./workspace-storage";
import { locationPreference, workspaceLocation } from "./workspace-location";

/** Normal updates keep mounted editors intact; Back/Forward restores only navigation state. */
export function createWorkspaceNavigation(
  base: ReturnType<typeof createWorkspaceStore>,
  account: AppAccount,
) {
  const preferences = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let location = new URL(window.location.href);
  let revision = 0;
  let queued = false;
  let active = true;
  let suspended = false;
  const commit = (replace: boolean) => {
    if (!active || suspended) return;
    const next = workspaceLocation(location, account, preferences);
    if (next.href !== window.location.href) {
      const beforeSearch = new URL(window.location.href);
      const afterSearch = new URL(next);
      beforeSearch.searchParams.delete("search");
      afterSearch.searchParams.delete("search");
      const replaceTyping = beforeSearch.href === afterSearch.href;
      window.history[replace || replaceTyping ? "replaceState" : "pushState"](null, "", next);
    }
    location = next;
  };
  const pop = () => {
    location = new URL(window.location.href);
    revision++;
    for (const notify of listeners) notify();
  };
  return {
    subscribe: (notify: () => void) => {
      if (listeners.size === 0) window.addEventListener("popstate", pop);
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) window.removeEventListener("popstate", pop);
      };
    },
    getRevision: () => revision,
    initialize() {
      active = true;
      commit(true);
      return () => {
        active = false;
      };
    },
    store: {
      ...base,
      setSuspended(value: boolean) {
        suspended = value;
        base.setSuspended(value);
      },
      read<T>(name: string, createDefault: () => T, decode: (value: unknown) => T): T {
        const saved = base.read(name, createDefault, decode);
        const value = decode(locationPreference(location, account, name, saved));
        preferences.set(name, value);
        return value;
      },
      write(name: string, value: unknown) {
        if (!active || suspended) return;
        base.write(name, value);
        preferences.set(name, value);
        if (!queued) {
          queued = true;
          queueMicrotask(() => {
            queued = false;
            commit(false);
          });
        }
      },
    },
  };
}
