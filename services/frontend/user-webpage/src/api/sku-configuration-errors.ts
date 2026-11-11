import { rpcErrorDetails } from "./rpc-error-details.ts";
import { parseConfigurationIssues } from "./sku-configuration-codec.ts";
import type { SkuConfigurationIssue } from "./sku-configuration-types.ts";

export class SkuConfigurationError extends Error {
  readonly kind: "incomplete" | "conflict" | "invalid" | "unconfirmed";
  readonly issues: SkuConfigurationIssue[];

  constructor(
    kind: SkuConfigurationError["kind"],
    message: string,
    issues: SkuConfigurationIssue[] = [],
  ) {
    super(message);
    this.name = "SkuConfigurationError";
    this.kind = kind;
    this.issues = issues;
  }
}

/** Derive user messages from fixed machine codes and validated gap facts. */
export function skuConfigurationRpcError(body: unknown): SkuConfigurationError | null {
  const error = rpcErrorDetails(body);
  if (!error) return null;
  if (error.sqlstate === "PT409" && error.detail.code === "SKU_CONFIGURATION_STALE")
    return new SkuConfigurationError(
      "conflict",
      "A SKU changed while you were editing. Load its latest saved settings before saving.",
    );
  if (error.sqlstate !== "23514") return null;
  if (error.detail.code === "SKU_CONFIGURATION_INVALID")
    return new SkuConfigurationError(
      "invalid",
      "Check the selected companies, fee rates, and date ranges. No changes were saved.",
    );
  if (error.detail.code !== "SKU_CONFIGURATION_INCOMPLETE") return null;
  try {
    const issues = parseConfigurationIssues(error.detail.issues);
    if (issues.length === 0) return null;
    return new SkuConfigurationError(
      "incomplete",
      "Each changed SKU needs a company and coverage for its required fees. No changes were saved.",
      issues,
    );
  } catch {
    return null;
  }
}
