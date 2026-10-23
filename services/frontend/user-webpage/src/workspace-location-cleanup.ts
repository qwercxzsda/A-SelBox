import type { RegisteredRouter } from "@tanstack/react-router";
import { WORKSPACE_SEARCH_PARAMETERS } from "./router-search.ts";

export function withoutWorkspaceLocation(url: URL): URL {
  const next = new URL(url);
  for (const key of Object.keys(WORKSPACE_SEARCH_PARAMETERS)) next.searchParams.delete(key);
  return next;
}

export function clearWorkspaceLocation(router: RegisteredRouter) {
  const next = withoutWorkspaceLocation(new URL(router.history.location.href, router.origin));
  void router.navigate({
    href: `${next.pathname}${next.search}${next.hash}`,
    replace: true,
    resetScroll: false,
  });
}
