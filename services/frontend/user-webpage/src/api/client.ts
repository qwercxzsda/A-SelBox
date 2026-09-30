import { createTransport } from "./transport.ts";
import { createAuthApi } from "./auth.ts";
import { createWorkspaceApi } from "./workspace.ts";
import { createDatasetApi } from "./datasets.ts";
import { createSummaryApi } from "./summaries.ts";
import { createPayoutApi } from "./payouts.ts";
import { createSkuConfigurationApi } from "./sku-configuration.ts";
import { createInventoryApi } from "./inventory.ts";
import type { ApiClientConfig } from "./client-config.ts";
export { ApiError } from "./transport.ts";

/** One public configuration and injectable fetch for all authenticated REST operations. */
export function createApiClient(
  configuration: ApiClientConfig,
  fetchImplementation: typeof fetch = globalThis.fetch,
) {
  const transport = createTransport(configuration, fetchImplementation);
  const datasets = createDatasetApi(transport);
  return {
    ...createAuthApi(transport),
    ...createWorkspaceApi(transport),
    ...datasets,
    ...createPayoutApi(transport),
    ...createSkuConfigurationApi(transport),
    ...createInventoryApi(transport),
    ...createSummaryApi(transport, (options) => datasets.fetchDatasetPage(options)),
  };
}
