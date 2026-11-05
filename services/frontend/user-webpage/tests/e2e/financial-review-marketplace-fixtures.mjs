import { REVIEW_COMPANY } from "./financial-review-fixtures.mjs";

const id = (number) => `0198b50b-701a-7000-8002-${String(number).padStart(12, "0")}`;
export const MARKETPLACE_SOURCE_VERSION = id(999);

export function setupMarketplaceReview(fixture) {
  fixture.financialReviewTotals = [];
  fixture.financialReviewTypeTotals = [];
  fixture.financialReviewRecords = [];
  function addMonth(marketplace, month, currency, totals, storage, advertising) {
    const scope = {
      category: "DATA_KIOSK",
      marketplace_name: marketplace,
      month: `${month}-01`,
      currency,
    };
    fixture.financialReviewTotals.push({
      ...scope,
      finances_amount: totals[0],
      data_kiosk_amount: totals[1],
      difference: totals[2],
      finances_row_count: "2",
      data_kiosk_row_count: "2",
    });
    for (const [source, component_type, amount] of [
      ["FINANCES", "STORAGE_FEES", storage[0]],
      ["DATA_KIOSK", "FBA_STORAGE_FEE", storage[1]],
      ["FINANCES", "ADVERTISING", advertising[0]],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS_CHARGE", advertising[1]],
    ]) {
      fixture.financialReviewTypeTotals.push({
        ...scope,
        source,
        component_type,
        amount,
        row_count: "1",
      });
      fixture.financialReviewRecords.push({
        ...scope,
        source,
        component_type,
        amount,
        source_row_id: id(fixture.financialReviewRecords.length + 1),
        source_version_id: MARKETPLACE_SOURCE_VERSION,
        activity_date: `${month}-15`,
        seller_namespace: "marketplace-review-fixture",
        sku: `${marketplace}-${currency}-${component_type}`,
      });
    }
  }
  // Explicit independent totals expose both shared-currency and same-market/unit mistakes.
  addMonth("Amazon.de", "2026-01", "EUR", ["-130", "-110", "-20"], ["-100", "-90"], ["-30", "-20"]);
  addMonth("Amazon.de", "2026-02", "EUR", ["-60", "-45", "-15"], ["-50", "-40"], ["-10", "-5"]);
  addMonth("Amazon.fr", "2026-01", "EUR", ["-9", "-4", "-5"], ["-7", "-3"], ["-2", "-1"]);
  addMonth("Amazon.com", "2026-01", "USD", ["-15", "-12", "-3"], ["-11", "-10"], ["-4", "-2"]);
  addMonth("Amazon.com", "2026-01", "EUR", ["-27", "-25", "-2"], ["-21", "-20"], ["-6", "-5"]);
  fixture.payoutRows = [
    ["Amazon.de", "EUR", "311"],
    ["Amazon.fr", "EUR", "422"],
    ["Amazon.com", "USD", "533"],
    ["Amazon.com", "EUR", "644"],
  ].map(([marketplace_name, currency, amount], index) => ({
    id: id(100 + index),
    company_id: REVIEW_COMPANY,
    marketplace_name,
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    currency,
    created_at: "2026-09-27T00:00:00Z",
    source_amount: amount,
    fee_amount: "0",
    company_amount: amount,
  }));
  fixture.payoutComponents = fixture.payoutRows.map((row) => ({
    id: `support-${row.id}`,
    report_id: row.id,
    authoritative: "false",
    source: "DATA_KIOSK",
    marketplace_name: row.marketplace_name,
    activity_date: "2026-01-15",
    sku: `SAVED-${row.marketplace_name}`,
    component_type: "NET_PRODUCT_SALES",
    source_amount: row.source_amount,
    fee_amount: null,
    company_amount: null,
  }));
}
