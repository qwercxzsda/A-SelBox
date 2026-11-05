// Amounts and expected totals are independent literals: no application family or decimal helpers.
export function setupFamilies(fixture, { extraFamilies = 0, offsettingMarch = false } = {}) {
  fixture.financialReviewTotals = [];
  fixture.financialReviewTypeTotals = [];
  fixture.financialReviewRecords = [];
  function period(month, currency, amounts, groups, category = "DATA_KIOSK") {
    const common = { month, currency, category, marketplace_name: "Amazon.com" };
    const counts = { FINANCES: 0, DATA_KIOSK: 0 };
    for (const [source, component_type, amount, values = [amount]] of groups) {
      counts[source] += values.length;
      fixture.financialReviewTypeTotals.push({
        ...common,
        source,
        component_type,
        amount,
        row_count: String(values.length),
      });
      for (const value of values) {
        const index = fixture.financialReviewRecords.length + 1;
        fixture.financialReviewRecords.push({
          source,
          category,
          currency,
          component_type,
          amount: value,
          source_row_id: `0198b50b-701a-7000-8000-${String(index).padStart(12, "0")}`,
          source_version_id: "0198b50b-701a-7000-8000-000000000099",
          activity_date: `${month.slice(0, 7)}-15`,
          seller_namespace: "family-review-fixture",
          marketplace_name: "Amazon.com",
          sku: `${source}:${component_type}`,
        });
      }
    }
    fixture.financialReviewTotals.push({
      ...common,
      finances_amount: amounts[0],
      data_kiosk_amount: amounts[1],
      difference: amounts[2],
      finances_row_count: String(counts.FINANCES),
      data_kiosk_row_count: String(counts.DATA_KIOSK),
    });
  }
  period(
    "2026-01-01",
    "USD",
    ["-71.008", "-60.002", "-11.006"],
    [
      ["FINANCES", "STORAGE_FEES", "-10.004"],
      ["DATA_KIOSK", "FBA_STORAGE_FEE", "-8.001"],
      ["FINANCES", "AGED_STORAGE_FEES", "-20"],
      ["DATA_KIOSK", "LONG_TERM_STORAGE_FEE", "-18"],
      ["FINANCES", "ADVERTISING", "-30.004"],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS", "-25.001"],
      ["FINANCES", "FUTURE_FEE", "-11"],
      ["DATA_KIOSK", "FUTURE_FEE", "-9"],
      ...Array.from({ length: extraFamilies }, (_, index) => [
        "FINANCES",
        `QA_EXTRA_FEE_${index}`,
        "0",
      ]),
    ],
  );
  period(
    "2026-02-01",
    "USD",
    ["-19.008", "-23.002", "3.994"],
    [
      ["FINANCES", "STORAGE_FEES", "-4.004"],
      ["DATA_KIOSK", "MONTHLY_INVENTORY_STORAGE_FEE", "-1.001"],
      ["FINANCES", "AGED_STORAGE_FEES", "-10"],
      ["DATA_KIOSK", "FBA_AGED_INVENTORY_SURCHARGE", "-12"],
      ["FINANCES", "ADVERTISING", "-5.004"],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS_CHARGE", "-10.001"],
    ],
  );
  period(
    "2026-03-01",
    "USD",
    ["0", "0", "0"],
    [
      ["FINANCES", "STORAGE_FEES", offsettingMarch ? "2" : "0"],
      ["DATA_KIOSK", "FBA_STORAGE_FEE", "0"],
      [
        "FINANCES",
        "ADVERTISING",
        offsettingMarch ? "-2" : "0",
        ["-12.5", offsettingMarch ? "10.5" : "12.5"],
      ],
      ["DATA_KIOSK", "SPONSORED_PRODUCT_FEE", "-12.5"],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS_CHARGES", "12.5"],
    ],
  );
  period(
    "2026-01-01",
    "EUR",
    ["-50", "-40", "-10"],
    [
      ["FINANCES", "STORAGE_FEES", "-30"],
      ["DATA_KIOSK", "FBA_STORAGE_FEE", "-25"],
      ["FINANCES", "ADVERTISING", "-20"],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS", "-15"],
    ],
  );
  period(
    "2025-12-01",
    "EUR",
    ["-300", "-270", "-30"],
    [
      ["FINANCES", "STORAGE_FEES", "-100"],
      ["DATA_KIOSK", "MONTHLY_INVENTORY_STORAGE_FEE", "-90"],
      ["FINANCES", "ADVERTISING", "-200"],
      ["DATA_KIOSK", "SPONSORED_PRODUCTS_CHARGES", "-180"],
    ],
  );
  period(
    "2025-12-01",
    "USD",
    ["-3", "-2", "-1"],
    [
      ["FINANCES", "STORAGE_FEES", "-3"],
      ["DATA_KIOSK", "FBA_STORAGE_FEE", "-2"],
    ],
  );
  period(
    "2026-01-01",
    "USD",
    ["7", "6", "1"],
    [
      ["FINANCES", "PRODUCT_SALES", "7"],
      ["DATA_KIOSK", "NET_PRODUCT_SALES", "6"],
    ],
    "FINANCES",
  );
}
