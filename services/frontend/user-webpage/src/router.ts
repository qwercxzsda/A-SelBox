import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import App from "./App";
import {
  parseWorkspaceSearch,
  stringifyWorkspaceSearch,
  validateWorkspaceSearch,
} from "./router-search";

// App's auth bootstrap removes callback tokens before the router reads the initial URL.
// The workspace lives in search parameters; retain support for deployments below any pathname.
const rootRoute = createRootRoute({ component: App, validateSearch: validateWorkspaceSearch });
const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, path: "$" });

export const appRouter = createRouter({
  routeTree: rootRoute.addChildren([workspaceRoute]),
  parseSearch: parseWorkspaceSearch,
  stringifySearch: stringifyWorkspaceSearch,
  defaultHashScrollIntoView: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}
