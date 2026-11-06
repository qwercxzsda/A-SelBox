export const REVIEW_COMPANY = "0198b50b-701a-7000-8000-000000000041";
export const REVIEW_REPORT = "0198b50b-701a-7000-8000-000000000042";

export function reviewAmounts(overrides = {}) {
  return {
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    finances_amount: "-100.25",
    data_kiosk_amount: "-101.5",
    difference: "1.25",
    finances_row_count: "25",
    data_kiosk_row_count: "26",
    ...overrides,
  };
}

/** Complete prior year, current mature months, multiple currencies, and a gap year. */
export function setupManyFinancialReviewRows(fixture) {
  const rows = [];
  for (const [year, months] of [
    [2025, 12],
    [2026, 7],
  ])
    for (let month = 1; month <= months; month++)
      for (const currency of ["EUR", "JPY", "USD"])
        rows.push({
          month: `${year}-${String(month).padStart(2, "0")}-01`,
          currency,
          ...reviewAmounts(),
        });
  rows.push({ month: "2020-01-01", currency: "USD", ...reviewAmounts() });
  fixture.financialReviewTotals = [
    ...fixture.financialReviewTotals.filter(({ category }) => category !== "DATA_KIOSK"),
    ...rows,
  ];
}

const REVIEW_TYPES = {
  DATA_KIOSK: {
    FINANCES: "STORAGE_FEES",
    DATA_KIOSK: "FBA_STORAGE_FEE",
  },
  FINANCES: { FINANCES: "PRODUCT_SALES", DATA_KIOSK: "NET_PRODUCT_SALES" },
  SELBOX: { FINANCES: "SUBSCRIPTION_FEES" },
};

function setupCurrentReview(fixture) {
  fixture.financialReviewTotals = [
    { month: "2026-07-01", currency: "USD", ...reviewAmounts() },
    {
      month: "2026-07-01",
      currency: "EUR",
      ...reviewAmounts({
        finances_amount: "-10",
        data_kiosk_amount: "-10",
        difference: "0",
        finances_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-06-01",
      currency: "USD",
      ...reviewAmounts({
        data_kiosk_amount: "-112.75",
        difference: "12.5",
        finances_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "USD",
      ...reviewAmounts({
        category: "FINANCES",
        finances_amount: "500",
        data_kiosk_amount: "490",
        difference: "10",
        finances_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "EUR",
      ...reviewAmounts({
        category: "FINANCES",
        finances_amount: "70",
        data_kiosk_amount: "70",
        difference: "0",
        finances_row_count: "1",
        data_kiosk_row_count: "1",
      }),
    },
    {
      month: "2026-07-01",
      currency: "USD",
      ...reviewAmounts({
        category: "SELBOX",
        finances_amount: "-20",
        data_kiosk_amount: "0",
        difference: "-20",
        finances_row_count: "1",
        data_kiosk_row_count: "0",
      }),
    },
  ];
  fixture.financialReviewTypeTotals = [];
  fixture.financialReviewRecords = [];
  for (const total of fixture.financialReviewTotals) {
    for (const source of ["FINANCES", "DATA_KIOSK"]) {
      const key = source.toLowerCase();
      const count = Number(total[`${key}_row_count`]);
      if (!count) continue;
      const component_type = REVIEW_TYPES[total.category][source];
      fixture.financialReviewTypeTotals.push({
        month: total.month,
        category: total.category,
        marketplace_name: total.marketplace_name,
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
          marketplace_name: total.marketplace_name,
          sku: total.category === "SELBOX" ? null : `REVIEW-${String(index).padStart(2, "0")}`,
          amount: index === 0 ? total[`${key}_amount`] : "0",
        });
    }
  }
}

export function setupFinancialReview(fixture) {
  fixture.payoutPolicy = {
    mature_cutoff_date: "2026-08-27",
    latest_month: "2026-07-01",
    mature_cutoff_months: 2,
  };
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-a"] = REVIEW_COMPANY;
  fixture.companyNames[REVIEW_COMPANY] = "Review Company";
  setupCurrentReview(fixture);
  fixture.payoutRows = [
    {
      id: REVIEW_REPORT,
      company_id: REVIEW_COMPANY,
      marketplace_name: "Amazon.com",
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27T13:20:10Z",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
  ];
  fixture.payoutComponents = [
    {
      id: "payout-record",
      report_id: REVIEW_REPORT,
      authoritative: "true",
      source: "FINANCES",
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
  fixture.reportSourceRows = Array.from({ length: 51 }, (_, index) => {
    const dimensions = {
      report_id: REVIEW_REPORT,
      seller_namespace: index < 26 ? "seller-west" : "seller-east",
      activity_date: `2026-06-${String((index % 26) + 1).padStart(2, "0")}`,
      marketplace_name: "Amazon.com",
      currency: "USD",
      row_count: "1",
    };
    return [
      {
        ...dimensions,
        source: "FINANCES",
        category: "FINANCES",
        amount: index === 0 ? "500" : "0",
      },
      { ...dimensions, source: "FINANCES", category: "SELBOX", amount: index === 0 ? "-20" : "0" },
      {
        ...dimensions,
        source: "FINANCES",
        category: "DATA_KIOSK",
        amount: index === 0 ? "-100.25" : "0",
      },
      {
        ...dimensions,
        source: "DATA_KIOSK",
        category: "DATA_KIOSK",
        amount: index === 1 ? "-101.5" : "0",
      },
    ];
  }).flat();
}
