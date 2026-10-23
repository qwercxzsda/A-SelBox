import type { RegisteredRouter } from "@tanstack/react-router";
import type { AppAccount } from "./api/types";
import type { createWorkspaceStore } from "./workspace-storage";
import { locationPreference, workspaceLocation } from "./workspace-location.ts";

/** Normal updates keep mounted editors intact; Back/Forward restores only navigation state. */
export function createWorkspaceNavigation(
  base: ReturnType<typeof createWorkspaceStore>,
  account: AppAccount,
  router: RegisteredRouter,
) {
  const preferences = new Map<string, unknown>();
  const currentLocation = () => new URL(router.history.location.href, router.origin);
  let revision = 0;
  let queued = false;
  let active = true;
  let suspended = false;
  const commit = (replace: boolean) => {
    if (!active || suspended) return;
    const current = currentLocation();
    const next = workspaceLocation(current, account, preferences);
    if (next.href !== current.href) {
      const beforeSearch = new URL(current);
      const afterSearch = new URL(next);
      beforeSearch.searchParams.delete("search");
      afterSearch.searchParams.delete("search");
      const replaceTyping = beforeSearch.href === afterSearch.href;
      void router.navigate({
        href: `${next.pathname}${next.search}${next.hash}`,
        replace: replace || replaceTyping,
        resetScroll: false,
      });
    }
  };
  return {
    subscribe: (notify: () => void) =>
      router.history.subscribe(({ action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE") return;
        revision++;
        notify();
      }),
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
        const value = decode(locationPreference(currentLocation(), account, name, saved));
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
