export function setupEconomicFamilies(fixture) {
  fixture.financialReviewTotals = [];
  fixture.financialReviewTypeTotals = [];
  fixture.financialReviewRecords = [];
  function addCategory(category, amounts, groups) {
    const scope = { category, month: "2026-01-01", currency: "USD" };
    const counts = { FINANCES: 0, DATA_KIOSK: 0 };
    for (const [source, component_type, amount] of groups) {
      counts[source]++;
      fixture.financialReviewTypeTotals.push({
        ...scope,
        source,
        component_type,
        amount,
        row_count: "1",
      });
      const index = fixture.financialReviewRecords.length + 1;
      fixture.financialReviewRecords.push({
        ...scope,
        source,
        component_type,
        amount,
        source_row_id: `0198b50b-701a-7000-8000-${String(index).padStart(12, "0")}`,
        source_version_id: "0198b50b-701a-7000-8000-000000000099",
        activity_date: "2026-01-15",
        seller_namespace: "economic-families-fixture",
        marketplace_name: "Amazon.com",
        sku: "SKU-1",
      });
    }
    fixture.financialReviewTotals.push({
      ...scope,
      finances_amount: amounts[0],
      data_kiosk_amount: amounts[1],
      difference: amounts[2],
      finances_row_count: String(counts.FINANCES),
      data_kiosk_row_count: String(counts.DATA_KIOSK),
    });
  }
  // Expected source totals are independent literals; each original sign is retained.
  addCategory(
    "FINANCES",
    ["76", "76", "0"],
    [
      ["FINANCES", "PRODUCT_SALES", "100"],
      ["FINANCES", "PRODUCT_REFUNDS", "-20"],
      ["FINANCES", "ZERO_ACTIVITY", "0"],
      ["DATA_KIOSK", "NET_PRODUCT_SALES", "80"],
      ["FINANCES", "FBA_FULFILLMENT_FEES", "-7"],
      ["FINANCES", "FULFILLMENT_FEE_CORRECTIONS", "2"],
      ["FINANCES", "FULFILLMENT_FEE_REVERSALS", "1"],
      ["DATA_KIOSK", "FBA_FULFILLMENT_FEE", "-4"],
    ],
  );
  addCategory(
    "SELBOX",
    ["-12", "-5", "-7"],
    [
      ["FINANCES", "DEBT_RECOVERY", "-50"],
      ["FINANCES", "CROSS_ACCOUNT_ADJUSTMENTS", "20"],
      ["FINANCES", "RESERVE_MOVEMENTS", "30"],
      ["FINANCES", "SUBSCRIPTION_FEES", "-5"],
      ["DATA_KIOSK", "SUBSCRIPTION_FEE", "-5"],
      ["FINANCES", "EPR_FEES", "-2"],
      ["FINANCES", "VINE_FEES", "-3"],
      ["FINANCES", "INBOUND_DEFECT_FEES", "-4"],
      ["FINANCES", "MCF_CREDITS", "2"],
      ["FINANCES", "OTHER_ADJUSTMENTS", "-1"],
      ["FINANCES", "TAX_RECLASSIFICATION", "1"],
    ],
  );
}
