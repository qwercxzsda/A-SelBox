import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import { isJsonObject, isUuid, requireUuid } from "./validation.ts";
import { requireCalendarDate } from "./filters.ts";
import type { CanonicalRow } from "./types.ts";

export const OUTCOMES = ["DIFFERENCE", "SELBOX", "COMPANY"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const ASSIGNMENT_KINDS = ["CAMPAIGN", "PROMOTION", "SHIPMENT"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];
interface OutcomeFilters {
  outcome: Outcome;
  month: string;
  marketplace: string;
}
interface AssignmentFilters {
  kind: AssignmentKind | "";
  warningsOnly: boolean;
}
export interface Assignment {
  sellerNamespace: string;
  amazonScope: string;
  kind: AssignmentKind;
  nativeKey: string;
  companyId: string | null;
  versionId: string | null;
  suggestedCompanyId: string | null;
  warning: string | null;
  origin: string | null;
  products: { sku: string | null; asin: string | null; company_id: string | null }[];
}

function decodeAssignment(row: CanonicalRow): Assignment {
  const kind = ASSIGNMENT_KINDS.find((value) => value === row.kind);
  if (!kind || !row.seller_namespace || !row.native_key || !row.amazon_scope)
    throw new Error("An assignment is missing its source identity");
  const products: unknown = JSON.parse(row.products ?? "[]");
  if (!Array.isArray(products)) throw new Error("Invalid product hints");
  return {
    kind,
    nativeKey: row.native_key,
    sellerNamespace: row.seller_namespace,
    amazonScope: row.amazon_scope,
    companyId: row.company_id,
    versionId: row.current_version_id,
    origin: row.assignment_origin,
    warning: row.warning,
    suggestedCompanyId: row.suggested_company_id,
    products: products.map((product: unknown) => {
      if (!isJsonObject(product)) throw new Error("Invalid product hint");
      const { sku, asin, company_id } = product;
      if (
        (sku !== null && typeof sku !== "string") ||
        (asin !== null && typeof asin !== "string") ||
        (company_id !== null && !isUuid(company_id))
      )
        throw new Error("Invalid product hint");
      return { sku, asin, company_id };
    }),
  };
}

function pageParams(pageIndex: number, select: string, order: string) {
  validatePagination(pageIndex, DETAIL_PAGE_SIZE);
  return new URLSearchParams({
    select,
    order,
    limit: String(DETAIL_PAGE_SIZE + 1),
    offset: String(pageIndex * DETAIL_PAGE_SIZE),
  });
}
function reviewPageParams(
  pageIndex: number,
  select: string,
  order: string,
  month: string,
  marketplace: string,
) {
  validatePagination(pageIndex, DETAIL_PAGE_SIZE);
  const params = new URLSearchParams({
    // PostgREST emits RPC CSV headers alphabetically; request values in the same order.
    select: select.split(",").sort().join(","),
    order,
    p_limit: String(DETAIL_PAGE_SIZE + 1),
    p_offset: String(pageIndex * DETAIL_PAGE_SIZE),
  });
  if (month) {
    const start = month + "-01";
    requireCalendarDate(start);
    params.set("p_month", start);
  }
  if (marketplace) params.set("p_marketplace", marketplace);
  return params;
}

export function createAllocationApi(transport: ApiTransport) {
  async function readPage(
    token: string,
    endpoint: string,
    params: URLSearchParams,
    label: string,
    pageIndex: number,
    signal?: AbortSignal,
  ) {
    // A full count would run the financial calculation again just to enable Next.
    const { rows } = await transport.readCsvPage(token, endpoint, params, label, signal, false);
    const totalCount =
      rows.length > DETAIL_PAGE_SIZE ? null : pageIndex * DETAIL_PAGE_SIZE + rows.length;
    return { rows: rows.slice(0, DETAIL_PAGE_SIZE), totalCount };
  }
  return {
    async fetchFinancialOutcomes(
      token: string,
      filters: OutcomeFilters,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      const params = reviewPageParams(
        pageIndex,
        "source_row_id,seller_namespace,amazon_scope,marketplace_name,currency,posted_date,component_type,outcome,reason,selbox_group,source,source_version_id,reference_id,sku,skus,fnsku,asin,base_amount,tax_amount,company_id",
        "posted_date.desc,source_row_id,outcome,reason,marketplace_name",
        filters.month,
        filters.marketplace,
      );
      params.set("p_outcome", filters.outcome);
      const page = await readPage(
        token,
        "rpc/financial_outcome_page",
        params,
        "Financial outcomes",
        pageIndex,
        signal,
      );
      const rows = page.rows.map((row) => {
        const resolved: unknown = JSON.parse(row.skus ?? "[]");
        if (!Array.isArray(resolved) || !resolved.every((sku: unknown) => typeof sku === "string"))
          throw new Error("Invalid resolved SKU list");
        return { ...row, sku: row.sku ?? (resolved.join(", ") || null) };
      });
      return { ...page, rows };
    },
    fetchOutcomeMonths(
      token: string,
      month: string,
      marketplace: string,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      const params = reviewPageParams(
        pageIndex,
        "seller_namespace,amazon_scope,marketplace_name,currency,month,finances_base,finances_tax,company_base,company_tax,selbox_base,selbox_tax,difference_base,difference_tax",
        "month.desc,seller_namespace,amazon_scope,marketplace_name,currency",
        month,
        marketplace,
      );
      return readPage(
        token,
        "rpc/financial_review_month_page",
        params,
        "Monthly outcomes",
        pageIndex,
        signal,
      );
    },
    async fetchAssignmentStatus(
      token: string,
      filters: AssignmentFilters,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      const params = pageParams(
        pageIndex,
        "seller_namespace,amazon_scope,kind,native_key,company_id,current_version_id,suggested_company_id,warning,assignment_origin,products",
        "kind,seller_namespace,amazon_scope,native_key",
      );
      if (filters.kind) params.set("kind", "eq." + filters.kind);
      if (filters.warningsOnly) params.set("warning", "not.is.null");
      const page = await readPage(
        token,
        "assignment_status",
        params,
        "Source assignments",
        pageIndex,
        signal,
      );
      return { ...page, rows: page.rows.map(decodeAssignment) };
    },
    setReferenceAssignment(
      token: string,
      assignment: Assignment,
      companyId: string | null,
      memo: string,
    ) {
      if (companyId !== null) requireUuid(companyId, "company");
      return transport.postRpc(
        token,
        "set_reference_assignment",
        {
          p_seller_namespace: assignment.sellerNamespace,
          p_amazon_scope: assignment.amazonScope,
          p_kind: assignment.kind,
          p_native_key: assignment.nativeKey,
          p_company_id: companyId,
          p_memo: memo.trim(),
          p_expected_version_id: assignment.versionId,
        },
        "Save assignment",
      );
    },
  };
}
