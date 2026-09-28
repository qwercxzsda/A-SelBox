import { isJsonObject } from "./validation.ts";
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

/** Expose only the guarded publisher's fixed messages and validated gap fields. */
export function skuConfigurationRpcError(body: unknown): SkuConfigurationError | null {
  if (!isJsonObject(body)) return null;
  if (body.code === "PT409" && body.message === "SKU configuration changed while editing")
    return new SkuConfigurationError(
      "conflict",
      "A SKU changed while you were editing. Load its latest saved settings before saving.",
    );
  if (body.code !== "23514") return null;
  if (body.message === "Invalid SKU configuration")
    return new SkuConfigurationError(
      "invalid",
      "Check the selected companies, fee rates, and date ranges. No changes were saved.",
    );
  if (body.message !== "SKU configuration is incomplete" || typeof body.details !== "string")
    return null;
  try {
    const details: unknown = JSON.parse(body.details);
    if (!isJsonObject(details)) return null;
    const issues = parseConfigurationIssues(details.issues);
    if (issues.length === 0) return null;
    return new SkuConfigurationError(
      "incomplete",
      "Every known SKU needs a company and coverage for its required fees. No changes were saved.",
      issues,
    );
  } catch {
    return null;
  }
}
