import { createTransport } from "./transport.ts";
import { createAuthApi } from "./auth.ts";
import { createWorkspaceApi } from "./workspace.ts";
import { createMembershipApi } from "./membership.ts";
import { createCompanyApi } from "./companies.ts";
import { createDatasetApi } from "./datasets.ts";
import { createSummaryApi } from "./summaries.ts";
import { createPayoutApi } from "./payouts.ts";
import { createPayoutHistoryApi } from "./payout-history.ts";
import { createPayoutReadinessApi } from "./payout-readiness.ts";
import { createSkuConfigurationApi } from "./sku-configuration.ts";
import { createSkuConfigurationHistoryApi } from "./sku-configuration-history.ts";
import { createInventoryApi } from "./inventory.ts";

import { createFinancialReviewApi } from "./financial-review.ts";
import { createAssignmentApi } from "./assignments.ts";
import { createFinancialSourceApi } from "./financial-source.ts";
import { createRawDataApi } from "./raw-data.ts";
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
    ...createMembershipApi(transport),
    ...createCompanyApi(transport),
    ...datasets,
    ...createPayoutApi(transport),
    ...createPayoutHistoryApi(transport),
    ...createPayoutReadinessApi(transport),
    ...createSkuConfigurationApi(transport),
    ...createSkuConfigurationHistoryApi(transport),
    ...createInventoryApi(transport),
    ...createFinancialReviewApi(transport),
    ...createAssignmentApi(transport),
    ...createFinancialSourceApi(transport),
    ...createRawDataApi(transport),
    ...createSummaryApi(transport, (options) => datasets.fetchDatasetPage(options)),
  };
}
