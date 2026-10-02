export const REVIEW_COMPANY = "0198b50b-701a-7000-8000-000000000041";
export const REVIEW_REPORT = "0198b50b-701a-7000-8000-000000000042";

function reconciliationAmounts(overrides = {}) {
  return {
    settlement_category_amount: "500",
    selbox_category_amount: "-20",
    data_kiosk_settlement_control: "-100.25",
    data_kiosk_category_amount: "-101.5",
    difference: "1.25",
    settlement_total: "379.75",
    accounted_total: "379.75",
    ...overrides,
  };
}

export function reviewAmounts(overrides = {}) {
  return {
    category: "DATA_KIOSK",
    settlement_amount: "-100.25",
    data_kiosk_amount: "-101.5",
    difference: "1.25",
    settlement_row_count: "25",
    data_kiosk_row_count: "26",
    ...overrides,
  };
}

/** Enough month/currency groups to exercise split months, long pages, and an old source gap. */
export function setupManyFinancialReviewRows(fixture) {
  const currencies = [
    "AED",
    "AUD",
    "BRL",
    "CAD",
    "CHF",
    "CLP",
    "CNY",
    "COP",
    "CZK",
    "DKK",
    "EGP",
    "EUR",
    "GBP",
    "HKD",
    "HUF",
    "IDR",
    "ILS",
    "INR",
    "JPY",
    "KRW",
    "MXN",
    "MYR",
    "NOK",
    "NZD",
    "PHP",
    "PLN",
    "QAR",
    "SAR",
    "SEK",
    "SGD",
    "USD",
  ];
  const rows = currencies.map((currency) => ({
    month: "2026-07-01",
    currency,
    ...reviewAmounts(),
  }));
  for (let index = 0; index < 21; index++) {
    const month =
      index === 20
        ? "2020-01-01"
        : new Date(Date.UTC(2026, 5 - index, 1)).toISOString().slice(0, 10);
    for (const currency of ["EUR", "GBP", "JPY", "USD"])
      rows.push({ month, currency, ...reviewAmounts() });
  }
  fixture.financialReviewTotals = [
    ...fixture.financialReviewTotals.filter(({ category }) => category !== "DATA_KIOSK"),
    ...rows,
  ];
}

const REVIEW_TYPES = {
  DATA_KIOSK: {
    SETTLEMENT: "FBAFees/FBA Inventory Storage Fee/Base fee",
    DATA_KIOSK: "FBA_STORAGE_FEE",
  },
  SETTLEMENT: { SETTLEMENT: "PRODUCT_SALES", DATA_KIOSK: "NET_PRODUCT_SALES" },
  SELBOX: { SETTLEMENT: "ServiceFee/Subscription/Subscription Fee" },
};

function setupCurrentReview(fixture) {
  fixture.financialReviewTotals = [
    { month: "2026-07-01", currency: "USD", ...reviewAmounts() },
    {
      month: "2026-07-01",
      currency: "EUR",
      ...reviewAmounts({
        settlement_amount: "-10",
        data_kiosk_amount: "-10",
        difference: "0",
        settlement_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-06-01",
      currency: "USD",
      ...reviewAmounts({
        data_kiosk_amount: "-112.75",
        difference: "12.5",
        settlement_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "USD",
      ...reviewAmounts({
        category: "SETTLEMENT",
        settlement_amount: "500",
        data_kiosk_amount: "490",
        difference: "10",
        settlement_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "EUR",
      ...reviewAmounts({
        category: "SETTLEMENT",
        settlement_amount: "70",
        data_kiosk_amount: "70",
        difference: "0",
        settlement_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "USD",
      ...reviewAmounts({
        category: "SELBOX",
        settlement_amount: "-20",
        data_kiosk_amount: "0",
        difference: "-20",
        settlement_row_count: "1",
        data_kiosk_row_count: "0",
      }),
    },
  ];
  fixture.financialReviewTypeTotals = [];
  fixture.financialReviewRecords = [];
  for (const total of fixture.financialReviewTotals) {
    for (const source of ["SETTLEMENT", "DATA_KIOSK"]) {
      const key = source.toLowerCase();
      const count = Number(total[`${key}_row_count`]);
      if (!count) continue;
      const component_type = REVIEW_TYPES[total.category][source];
      fixture.financialReviewTypeTotals.push({
        month: total.month,
        category: total.category,
        currency: total.currency,
        source,
        component_type,
        amount: total[`${key}_amount`],
        row_count: String(count),
      });
      for (let index = 0; index < count; index++)
        fixture.financialReviewRecords.push({
          source,
          category: total.category,
          currency: total.currency,
          component_type,
          source_row_id: `${total.category}-${source}-${total.month}-${total.currency}-${index}`,
          source_version_id: `current-${source.toLowerCase()}-version`,
          activity_date: `${total.month.slice(0, 7)}-${String((index % 25) + 1).padStart(2, "0")}`,
          seller_namespace: index % 2 ? "seller-east" : "seller-west",
          marketplace_name: index % 2 ? "Amazon.com" : null,
          sku: total.category === "SELBOX" ? null : `REVIEW-${String(index).padStart(2, "0")}`,
          amount: index === 0 ? total[`${key}_amount`] : "0",
        });
    }
  }
}

export function setupFinancialReview(fixture) {
  fixture.roles["member-a"] = "operator";
  fixture.companyIds["member-a"] = REVIEW_COMPANY;
  fixture.companyNames[REVIEW_COMPANY] = "Review Company";
  setupCurrentReview(fixture);
  const savedTotals = [
    { month: "2026-07-01", currency: "USD", ...reconciliationAmounts(), source_group_count: "50" },
    {
      month: "2026-07-01",
      currency: "EUR",
      ...reconciliationAmounts({
        data_kiosk_settlement_control: "-10",
        data_kiosk_category_amount: "-10",
        difference: "0",
        settlement_total: "470",
        accounted_total: "470",
      }),
      source_group_count: "1",
    },
    {
      month: "2026-06-01",
      currency: "USD",
      ...reconciliationAmounts({ data_kiosk_category_amount: "-112.75", difference: "12.5" }),
      source_group_count: "1",
    },
  ];
  const savedDetails = Array.from({ length: 50 }, (_, index) => ({
    seller_namespace: index % 2 ? "seller-east" : "seller-west",
    activity_date: `2026-07-${String((index % 25) + 1).padStart(2, "0")}`,
    marketplace_name: index % 2 ? "Amazon.com" : null,
    currency: "USD",
    ...reconciliationAmounts({
      settlement_category_amount: index === 0 ? "500" : "0",
      selbox_category_amount: index === 0 ? "-20" : "0",
      data_kiosk_settlement_control: index === 0 ? "-100.25" : "0",
      data_kiosk_category_amount: index === 1 ? "-101.5" : "0",
      difference: index === 0 ? "-100.25" : index === 1 ? "101.5" : "0",
      settlement_total: index === 0 ? "379.75" : "0",
      accounted_total: index === 0 ? "379.75" : "0",
    }),
  }));
  savedDetails.push({
    ...savedTotals[1],
    seller_namespace: "seller-europe",
    activity_date: "2026-07-12",
    marketplace_name: "Amazon.de",
  });
  fixture.payoutRows = [
    {
      id: REVIEW_REPORT,
      company_id: REVIEW_COMPANY,
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27T13:20:10Z",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      reconciliation_count: "51",
    },
  ];
  fixture.payoutComponents = [
    {
      id: "payout-record",
      report_id: REVIEW_REPORT,
      authoritative: "true",
      source: "SETTLEMENT",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      component_type: "PRODUCT_SALES",
    },
    ...Array.from({ length: 51 }, (_, index) => ({
      id: `support-${index}`,
      report_id: REVIEW_REPORT,
      authoritative: "false",
      source: "DATA_KIOSK",
      activity_date: "2026-06-12",
      sku: `SUPPORT-${String(index).padStart(2, "0")}`,
      marketplace_name: "Amazon.com",
      component_type: "NET_PRODUCT_SALES",
      source_amount: index === 0 ? "0" : "102",
      quantity: "1",
      fee_amount: null,
      company_amount: null,
    })),
  ];
  fixture.payoutReconciliationTotals = savedTotals
    .filter((row) => row.month === "2026-07-01")
    .map((row) => ({ ...row, report_id: REVIEW_REPORT }));
  fixture.payoutReconciliation = savedDetails.map((row, index) => ({
    ...row,
    report_id: REVIEW_REPORT,
    row_number: String(index + 1),
    activity_date: row.activity_date.replace("2026-07", "2026-06"),
  }));
}
