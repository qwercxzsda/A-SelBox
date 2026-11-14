import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFinancialReviewFamilies,
  buildFinancialReviewFamilyMonths,
} from "../src/financial-review-families.ts";
import {
  buildTypeFamilyOptions,
  typeFamilyTypeSelections,
  normalizeTypeFamilyIds,
  unavailableTypeFamilyIds,
  resolveTypeFamily,
} from "../src/transaction-type-family-catalog.ts";
import { TRANSACTION_TYPE_FAMILIES } from "../src/transaction-type-families.ts";
import { sumExactDecimals } from "../src/decimal.ts";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";
const row = (source, component_type, amount, overrides = {}) => ({
  source,
  component_type,
  amount,
  month: "2026-07-01",
  category: "DATA_KIOSK",
  marketplace_name: "Amazon.com",
  currency: "USD",
  row_count: "1",
  ...overrides,
});
const taxonomy = JSON.parse(
  readFileSync(new URL("../src/generated/transaction-types.json", import.meta.url), "utf8"),
);

test("related fee types aggregate exactly with zero rows retained", () => {
  const result = buildFinancialReviewFamilies([
    row("FINANCES", "COUPON_FEES", "-6.530000009"),
    row("DATA_KIOSK", "COUPON_PARTICIPATION_FEE", "-5"),
    row("DATA_KIOSK", "COUPON_PERFORMANCE_FEE", "-1.530000001"),
    row("FINANCES", "DISPOSAL_FEES", "0"),
  ]);
  const coupons = result.find((item) => item.family_id === "coupons");
  assert.equal(coupons.finances_amount, "-6.530000009");
  assert.equal(coupons.data_kiosk_amount, "-6.530000001");
  assert.equal(coupons.difference, "-0.000000008");
  assert.equal(coupons.finances_row_count, "1");
  assert.equal(coupons.data_kiosk_row_count, "2");
  assert.equal(coupons.data_kiosk_types, "COUPON_PARTICIPATION_FEE, COUPON_PERFORMANCE_FEE");
  const disposal = result.find((item) => item.family_id === "disposal");
  assert.equal(disposal.difference, "0");
  assert.equal(disposal.coverage, "No Data Kiosk rows in this scope");
  assert.equal(disposal.data_kiosk_row_count, "0");
  assert.equal(result.length, 2);
});

test("monthly storage, aged storage and Sponsored products pair as distinct families", () => {
  for (const [id, label, financesType, kioskTypes] of [
    [
      "monthly-storage",
      "Monthly storage fees",
      "STORAGE_FEES",
      ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
    ],
    [
      "aged-storage",
      "Aged inventory surcharges",
      "AGED_STORAGE_FEES",
      ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE"],
    ],
    [
      "sponsored-products",
      "Sponsored products",
      "ADVERTISING",
      [
        "SPONSORED_PRODUCT_FEE",
        "SPONSORED_PRODUCTS",
        "SPONSORED_PRODUCTS_CHARGE",
        "SPONSORED_PRODUCTS_CHARGES",
      ],
    ],
  ]) {
    assert.equal(resolveTypeFamily("FINANCES", financesType).id, id);
    const result = buildFinancialReviewFamilies([
      row("FINANCES", financesType, "-10"),
      ...kioskTypes.map((type) => row("DATA_KIOSK", type, "-1.25")),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].family_id, id);
    assert.equal(result[0].family, label);
    assert.equal(result[0].coverage, "Both sources");
    assert.equal(result[0].data_kiosk_amount, sumExactDecimals(kioskTypes.map(() => "-1.25")));
    for (const type of kioskTypes) assert.equal(resolveTypeFamily("DATA_KIOSK", type).id, id);
  }
});

test("Sponsored Brands and Display aliases stay separate from Products and each other", () => {
  for (const [type, id] of [
    ["BRANDS", "sponsored-brands"],
    ["DISPLAY", "sponsored-display"],
  ]) {
    for (const suffix of ["", "_CHARGE", "_CHARGES"]) {
      const family = resolveTypeFamily("DATA_KIOSK", `SPONSORED_${type}${suffix}`);
      assert.equal(family.id, id);
      assert.deepEqual(family.financesTypes, []);
    }
  }
  assert.equal(
    resolveTypeFamily("FINANCES", "INBOUND_TRANSPORTATION_FEES").id,
    resolveTypeFamily("FINANCES", "INBOUND_TRANSPORTATION_PROGRAM_FEES").id,
  );
});

test("every supported monetary source type belongs to one explicit family", () => {
  const memberships = TRANSACTION_TYPE_FAMILIES.flatMap((family) => [
    ...family.financesTypes.map((type) => ["FINANCES", type, family.id]),
    ...family.dataKioskTypes.map((type) => ["DATA_KIOSK", type, family.id]),
  ]);
  assert.equal(
    new Set(TRANSACTION_TYPE_FAMILIES.map((family) => family.id)).size,
    TRANSACTION_TYPE_FAMILIES.length,
  );
  assert.equal(
    new Set(memberships.map(([source, type]) => JSON.stringify([source, type]))).size,
    memberships.length,
  );
  assert.equal(memberships.length, taxonomy.length);
  for (const { source, type } of taxonomy) {
    const matches = memberships.filter(
      ([memberSource, memberType]) => source === memberSource && type === memberType,
    );
    assert.equal(matches.length, 1, `${source}/${type}`);
    const family = resolveTypeFamily(source, type);
    assert.equal(family.id, matches[0][2]);
    assert.ok(family.label);
    assert.ok(family.description);
    assert.equal(family.id.startsWith("source:"), false);
  }
});

test("uncertain identities and unknown types receive separate named families", () => {
  const rows = [
    row("DATA_KIOSK", "FBA_INBOUND_PLACEMENT_SERVICE_FEE", "-90"),
    row("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE", "-10"),
    row("FINANCES", "FUTURE_FEE", "0"),
    row("DATA_KIOSK", "FUTURE_FEE", "3.0000000000001"),
  ];
  const result = buildFinancialReviewFamilies(rows);
  assert.equal(result.length, rows.length);
  assert.equal(new Set(result.map((item) => item.family_id)).size, rows.length);
  const future = result.filter((item) => item.family_id.startsWith("source:"));
  assert.deepEqual(
    new Set(future.map((item) => item.family)),
    new Set(["Future fee · Finances", "Future fee · Data Kiosk"]),
  );
  assert.equal(future.find((item) => item.family.endsWith("Finances")).finances_amount, "0");
  assert.equal(
    future.find((item) => item.family.endsWith("Data Kiosk")).data_kiosk_amount,
    "3.0000000000001",
  );
  assert.deepEqual(buildFinancialReviewFamilies([]), []);
  assert.deepEqual(buildFinancialReviewFamilyMonths([]), []);
});

test("net product sales include signed refunds without absorbing unclassified zero activity, promotions or tax", () => {
  const rows = [
    row("FINANCES", "PRODUCT_SALES", "100.123456789", { category: "FINANCES", row_count: "5" }),
    row("FINANCES", "PRODUCT_REFUNDS", "-20.000000001", { category: "FINANCES", row_count: "2" }),
    row("FINANCES", "ZERO_ACTIVITY", "0", { category: "FINANCES", row_count: "3" }),
    row("DATA_KIOSK", "NET_PRODUCT_SALES", "80.123456780", {
      category: "FINANCES",
      row_count: "7",
    }),
    row("FINANCES", "PROMOTIONAL_REBATES", "-7", { category: "FINANCES" }),
    row("FINANCES", "PRODUCT_TAX", "8", { category: "FINANCES" }),
  ];
  const original = structuredClone(rows);
  for (const ids of [["net-product-sales"], ["net-product-sales", "net-product-sales"]]) {
    const families = buildFinancialReviewFamilies(rows, ids);
    assert.equal(families.length, 1);
    assert.equal(families[0].family_id, "net-product-sales");
    assert.equal(families[0].finances_amount, "80.123456788");
    assert.equal(families[0].data_kiosk_amount, "80.12345678");
    assert.equal(families[0].difference, null);
    assert.equal(families[0].source_gap, "0.000000008");
    assert.equal(families[0].comparison_kind, "different-basis");
    assert.equal(families[0].finances_row_count, "7");
    assert.equal(families[0].data_kiosk_row_count, "7");
    assert.equal(families[0].coverage, "Both sources");
    assert.equal(families[0].finances_types, "PRODUCT_REFUNDS, PRODUCT_SALES");
    const months = buildFinancialReviewFamilyMonths(rows, ids);
    assert.equal(months.length, 1);
    assert.equal(months[0].difference, "0.000000008");
    assert.equal(months[0].finances_row_count, "7");
  }
  const zero = buildFinancialReviewFamilies(rows, ["zero-value-activity"]);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].finances_amount, "0");
  assert.equal(zero[0].finances_row_count, "3");
  assert.equal(zero[0].coverage, "Finances mapping only");
  assert.deepEqual(rows, original);
});

test("fee and reimbursement families net their reversals while preserving source signs", () => {
  for (const [id, finances, kiosk, expectedFinances, expectedKiosk, difference] of [
    [
      "fba-fulfillment",
      [
        ["FBA_FULFILLMENT_FEES", "-50.000000009"],
        ["FULFILLMENT_FEE_CORRECTIONS", "5"],
        ["FULFILLMENT_FEE_REVERSALS", "2.000000001"],
      ],
      [["FBA_FULFILLMENT_FEE", "-43"]],
      "-43.000000008",
      "-43",
      "-0.000000008",
    ],
    [
      "referral",
      [
        ["REFERRAL_FEES", "-15"],
        ["REFUNDED_REFERRAL_FEES", "3"],
      ],
      [
        ["REFERRAL_FEE", "-8"],
        ["REFERRAL_FEES", "-7"],
        ["REFUNDED_REFERRAL_FEE", "3"],
      ],
      "-12",
      "-12",
      "0",
    ],
    [
      "inventory-reimbursements",
      [
        ["INVENTORY_REIMBURSEMENTS", "20"],
        ["INVENTORY_REIMBURSEMENT_REVERSALS", "-20"],
      ],
      [["FBA_INVENTORY_REIMBURSEMENT", "0"]],
      "0",
      "0",
      "0",
    ],
    [
      "liquidation-fees",
      [["LIQUIDATION_FEES", "-8"]],
      [
        ["LIQUIDATION_PROCESSING_FEE", "-5"],
        ["LIQUIDATION_REFERRAL_FEE", "-3"],
      ],
      "-8",
      "-8",
      "0",
    ],
  ]) {
    const rows = [
      ...finances.map(([type, amount]) => row("FINANCES", type, amount, { category: "FINANCES" })),
      ...kiosk.map(([type, amount]) => row("DATA_KIOSK", type, amount, { category: "FINANCES" })),
    ];
    const families = buildFinancialReviewFamilies(rows);
    assert.equal(families.length, 1, id);
    assert.equal(families[0].family_id, id);
    assert.equal(families[0].finances_amount, expectedFinances);
    assert.equal(families[0].data_kiosk_amount, expectedKiosk);
    assert.equal(families[0].difference, difference);
    assert.equal(families[0].finances_row_count, String(finances.length));
    assert.equal(families[0].data_kiosk_row_count, String(kiosk.length));
    assert.equal(families[0].coverage, "Both sources");
  }
  assert.equal(resolveTypeFamily("FINANCES", "REFUND_COMMISSION").id, "referral");
  assert.equal(resolveTypeFamily("DATA_KIOSK", "REFUND_COMMISSION_FEE").id, "referral");
  assert.equal(resolveTypeFamily("FINANCES", "LIQUIDATION_PROCEEDS").id, "liquidation-proceeds");
  for (const alias of ["FBA_FULFILLMENT_FEES", "FBA_FULFILMENT_FEE"])
    assert.equal(resolveTypeFamily("DATA_KIOSK", alias).id, "fba-fulfillment");
});

test("unpaired economic families combine related signed movements without mixing their purposes", () => {
  for (const [id, category, components, expected] of [
    [
      "shipping",
      "FINANCES",
      [
        ["SHIPPING_CREDITS", "10"],
        ["SHIPPING_REFUNDS", "-3"],
        ["SHIPPING_CHARGEBACKS", "-2"],
      ],
      "5",
    ],
    [
      "gift-wrapping",
      "FINANCES",
      [
        ["GIFT_WRAP_CREDITS", "4"],
        ["GIFT_WRAP_CHARGEBACKS", "-1"],
      ],
      "3",
    ],
    [
      "taxes",
      "FINANCES",
      [
        ["PRODUCT_TAX", "2"],
        ["SHIPPING_TAX", "3"],
        ["GIFT_WRAP_TAX", "1"],
        ["TAX_WITHHELD", "-6"],
      ],
      "0",
    ],
    [
      "promotions",
      "FINANCES",
      [
        ["PROMOTIONAL_REBATES", "-7"],
        ["PROMOTIONAL_REFUNDS", "2"],
        ["POINTS", "-1"],
      ],
      "-6",
    ],
    ["epr-compliance", "SELBOX", [["EPR_FEES", "-3"]], "-3"],
    ["vine-enrollment", "SELBOX", [["VINE_FEES", "-4"]], "-4"],
    ["inbound-defects", "SELBOX", [["INBOUND_DEFECT_FEES", "-5"]], "-5"],
    ["supply-chain-credits", "SELBOX", [["MCF_CREDITS", "7"]], "7"],
    ["account-adjustments", "SELBOX", [["OTHER_ADJUSTMENTS", "-2"]], "-2"],
    [
      "balance-movements",
      "SELBOX",
      [
        ["DEBT_RECOVERY", "10"],
        ["CROSS_ACCOUNT_ADJUSTMENTS", "-4"],
        ["RESERVE_MOVEMENTS", "-3"],
        ["BANK_TRANSFERS", "-3"],
      ],
      "0",
    ],
  ]) {
    const rows = components.map(([type, amount]) => row("FINANCES", type, amount, { category }));
    const families = buildFinancialReviewFamilies(rows);
    assert.equal(families.length, 1, id);
    assert.equal(families[0].family_id, id);
    assert.equal(families[0].finances_amount, expected);
    assert.equal(families[0].data_kiosk_amount, null);
    assert.equal(families[0].data_kiosk_row_count, "0");
    assert.equal(families[0].difference, null);
    assert.equal(families[0].source_gap, expected);
    assert.equal(families[0].finances_row_count, String(components.length));
    assert.equal(families[0].coverage, "Finances mapping only");
  }
  assert.equal(resolveTypeFamily("FINANCES", "SUBSCRIPTION_FEES").id, "subscription");
  assert.equal(resolveTypeFamily("DATA_KIOSK", "SUBSCRIPTION_FEE").id, "subscription");
  assert.equal(resolveTypeFamily("FINANCES", "TAX_RECLASSIFICATION").id, "tax-reclassification");
});

test("current family IDs deduplicate while unsupported request IDs are rejected", () => {
  const ids = ["net-product-sales", "referral", "net-product-sales"];
  assert.deepEqual(normalizeTypeFamilyIds([...ids, null, "invalid"]), [
    "invalid",
    "net-product-sales",
    "referral",
  ]);
  const selection = typeFamilyTypeSelections(ids);
  assert.deepEqual(
    new Set(selection.financesTypes),
    new Set([
      "PRODUCT_SALES",
      "PRODUCT_REFUNDS",
      "REFERRAL_FEES",
      "REFUNDED_REFERRAL_FEES",
      "REFUND_COMMISSION",
    ]),
  );
  assert.deepEqual(
    new Set(selection.dataKioskTypes),
    new Set([
      "NET_PRODUCT_SALES",
      "REFERRAL_FEE",
      "REFERRAL_FEES",
      "REFUNDED_REFERRAL_FEE",
      "REFUND_COMMISSION_FEE",
    ]),
  );
  assert.equal(selection.financesTypes.length, 5);
  assert.equal(selection.dataKioskTypes.length, 5);
  assert.deepEqual(
    buildTypeFamilyOptions([], ids)
      .map((family) => family.id)
      .sort(),
    ["net-product-sales", "referral"],
  );
  for (const removed of [
    "refund-commission",
    "inbound-transportation-program",
    "unregistered-family",
  ]) {
    assert.throws(() => typeFamilyTypeSelections([removed]));
    assert.deepEqual(normalizeTypeFamilyIds([removed]), [removed]);
    assert.deepEqual(unavailableTypeFamilyIds([removed]), [removed]);
  }
});

test("native inbound convenience fees pair without including placement service fees", () => {
  assert.equal(resolveTypeFamily("FINANCES", "INBOUND_PLACEMENT_FEES").id, "inbound-convenience");
  assert.equal(
    resolveTypeFamily("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE").id,
    "inbound-convenience",
  );
  assert.deepEqual(typeFamilyTypeSelections(["inbound-convenience"]), {
    financesTypes: ["INBOUND_PLACEMENT_FEES"],
    dataKioskTypes: ["FBA_INBOUND_CONVENIENCE_FEE"],
  });
  const result = buildFinancialReviewFamilies([
    row("FINANCES", "INBOUND_PLACEMENT_FEES", "-100.000000001"),
    row("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE", "-90"),
    row("DATA_KIOSK", "FBA_INBOUND_PLACEMENT_SERVICE_FEE", "-10"),
  ]);
  assert.equal(result.length, 2);
  const convenience = result.find((item) => item.family_id === "inbound-convenience");
  assert.equal(convenience.coverage, "Both sources");
  assert.equal(convenience.difference, "-10.000000001");
  assert.equal(convenience.finances_types, "INBOUND_PLACEMENT_FEES");
  assert.equal(convenience.data_kiosk_types, "FBA_INBOUND_CONVENIENCE_FEE");
  const placement = result.find((item) => item.family_id === "inbound-placement");
  assert.equal(placement.coverage, "Data Kiosk mapping only");
  assert.equal(placement.data_kiosk_amount, "-10");
});

test("family selections preserve exact source-qualified types and reject malformed IDs", () => {
  const rawType = 'Future / "fee",(test): % + 日本語';
  const unknown = resolveTypeFamily("FINANCES", rawType);
  const selection = typeFamilyTypeSelections(["monthly-storage", unknown.id, "monthly-storage"]);
  assert.deepEqual(selection, {
    financesTypes: ["STORAGE_FEES", rawType],
    dataKioskTypes: ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
  });
  assert.deepEqual(typeFamilyTypeSelections(["sponsored-brands"]), {
    financesTypes: [],
    dataKioskTypes: ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  });
  assert.equal(typeFamilyTypeSelections([]), null);
  assert.deepEqual(
    normalizeTypeFamilyIds([unknown.id, null, "missing-id", "monthly-storage", unknown.id]),
    ["missing-id", "monthly-storage", unknown.id],
  );
  assert.deepEqual(normalizeTypeFamilyIds("monthly-storage"), []);
  for (const value of [
    null,
    [null],
    ["missing-id"],
    ["source:OTHER:X"],
    ["source:FINANCES:%"],
    ["source:FINANCES:STORAGE_FEES"],
    ["source:FINANCES:%00"],
  ]) {
    assert.throws(() => typeFamilyTypeSelections(value));
    assert.throws(() => buildFinancialReviewFamilyMonths([], value));
  }
  assert.throws(() => resolveTypeFamily("SETTLEMENT", "STORAGE_FEES"));
  assert.throws(() => resolveTypeFamily("FINANCES", ""));
});

test("family options include observed identities and retain selected families with no current rows", () => {
  const rows = [
    row("FINANCES", "ADVERTISING", "0"),
    row("DATA_KIOSK", "SPONSORED_PRODUCTS", "0"),
    row("DATA_KIOSK", "FUTURE_FEE", "0"),
  ];
  const options = buildTypeFamilyOptions(rows, ["aged-storage"]);
  assert.deepEqual(
    new Set(options.map((item) => item.id)),
    new Set(["aged-storage", "sponsored-products", "source:DATA_KIOSK:FUTURE_FEE"]),
  );
  assert.equal(options.length, 3);
  assert.deepEqual(buildTypeFamilyOptions([]), []);
  assert.throws(() => buildTypeFamilyOptions([], ["bad"]));
});

test("year aggregation sums repeated monthly types exactly and filters family unions without filling gaps", () => {
  const rows = [
    row("FINANCES", "STORAGE_FEES", "-9007199254740993.000000001", {
      month: "2026-01-01",
      row_count: "9007199254740993",
    }),
    row("DATA_KIOSK", "FBA_STORAGE_FEE", "-9007199254740993", { month: "2026-01-01" }),
    row("FINANCES", "STORAGE_FEES", "7.000000001", { month: "2026-03-01", row_count: "2" }),
    row("DATA_KIOSK", "FBA_STORAGE_FEE", "8", { month: "2026-03-01" }),
    row("DATA_KIOSK", "MONTHLY_INVENTORY_STORAGE_FEE", "-8", { month: "2026-03-01" }),
    row("FINANCES", "AGED_STORAGE_FEES", "0", { month: "2026-03-01" }),
    row("FINANCES", "ADVERTISING", "-100", { month: "2026-02-01" }),
  ];
  const original = structuredClone(rows);
  const ids = ["monthly-storage", "aged-storage"];
  const months = buildFinancialReviewFamilyMonths(rows, ids);
  assert.deepEqual(
    months.map((item) => item.month),
    ["2026-01-01", "2026-03-01"],
  );
  assert.equal(months[0].difference, "-0.000000001");
  assert.equal(months[0].finances_row_count, "9007199254740993");
  assert.equal(months[1].data_kiosk_amount, "0");
  assert.equal(months[1].data_kiosk_row_count, "2");
  assert.equal(months[1].finances_row_count, "3");
  assert.equal(months[1].difference, "7.000000001");
  const families = buildFinancialReviewFamilies(rows, ids);
  assert.equal(families.length, 2);
  const storage = families.find((item) => item.family_id === "monthly-storage");
  assert.equal(storage.finances_amount, "-9007199254740986");
  assert.equal(storage.finances_row_count, "9007199254740995");
  assert.equal(storage.difference, "7");
  assert.deepEqual(rows, original);
});

test("all-family totals and counts reconcile to every input source including unknown and analysis types", () => {
  const rows = taxonomy.map(({ source, type, category }, index) =>
    row(source, type, index % 3 === 0 ? "0" : index % 3 === 1 ? "-1.000000009" : "2.000000001", {
      category,
    }),
  );
  rows.push(row("FINANCES", "UNKNOWN_TOTAL", "999999999999999999.123456789"));
  rows.push(row("DATA_KIOSK", "UNKNOWN_TOTAL", "-0.000000001"));
  const families = buildFinancialReviewFamilies(rows);
  const months = buildFinancialReviewFamilyMonths(rows, []);
  for (const [source, amountKey, countKey] of [
    ["FINANCES", "finances_amount", "finances_row_count"],
    ["DATA_KIOSK", "data_kiosk_amount", "data_kiosk_row_count"],
  ]) {
    const expected = rows.filter((item) => item.source === source);
    const total = sumExactDecimals(expected.map((item) => item.amount));
    for (const aggregated of [families, months]) {
      assert.equal(sumExactDecimals(aggregated.map((item) => item[amountKey])), total);
      assert.equal(
        aggregated.reduce((count, item) => count + BigInt(item[countKey]), 0n),
        BigInt(expected.length),
      );
    }
  }
});

test("monthly totals preserve independent currency and category scopes", () => {
  const rows = [
    row("FINANCES", "FUTURE_FEE", "1"),
    row("FINANCES", "FUTURE_FEE", "2", { currency: "EUR" }),
    row("FINANCES", "FUTURE_FEE", "3", { category: "SELBOX" }),
  ];
  const months = buildFinancialReviewFamilyMonths(rows);
  assert.equal(months.length, 3);
  assert.deepEqual(
    new Set(months.map((item) => `${item.category}/${item.currency}/${item.finances_amount}`)),
    new Set(["DATA_KIOSK/USD/1", "DATA_KIOSK/EUR/2", "SELBOX/USD/3"]),
  );
  assert.throws(() => buildFinancialReviewFamilies(rows), /one currency/);
});

test("same-currency marketplaces retain independent monthly totals and cannot form one family comparison", () => {
  const germany = row("FINANCES", "STORAGE_FEES", "-10.000000009", {
    marketplace_name: "Amazon.de",
    currency: "EUR",
  });
  const france = { ...germany, marketplace_name: "Amazon.fr", amount: "-2.000000001" };
  const months = buildFinancialReviewFamilyMonths([france, germany]);
  assert.deepEqual(
    months.map(({ marketplace_name, currency, difference }) => [
      marketplace_name,
      currency,
      difference,
    ]),
    [
      ["Amazon.de", "EUR", "-10.000000009"],
      ["Amazon.fr", "EUR", "-2.000000001"],
    ],
  );
  assert.throws(() => buildFinancialReviewFamilies([germany, france]), /one marketplace/);
  assert.equal(buildFinancialReviewFamilies([germany])[0].marketplace_name, "Amazon.de");
});

test("family aggregates fail closed on malformed values even in unselected families", () => {
  const valid = row("FINANCES", "COUPON_FEES", "1");
  for (const overrides of [
    { amount: null },
    { amount: "bad" },
    { amount: undefined },
    { row_count: null },
    { row_count: undefined },
    { row_count: "1.5" },
    { row_count: "-1" },
    { month: "2026-02-30" },
    { month: "2026-07-02" },
    { currency: "bad" },
    { source: "SETTLEMENT" },
    { component_type: null },
    { category: "UNKNOWN" },
    { marketplace_name: null },
    { marketplace_name: "Germany" },
  ]) {
    for (const aggregate of [buildFinancialReviewFamilies, buildFinancialReviewFamilyMonths]) {
      assert.throws(() => aggregate([{ ...valid, ...overrides }]));
      assert.throws(() => aggregate([{ ...valid, ...overrides }], ["monthly-storage"]));
    }
  }
  for (const aggregate of [buildFinancialReviewFamilies, buildFinancialReviewFamilyMonths])
    assert.throws(() => aggregate([valid, { ...valid, amount: "2" }]), /duplicate/);
});

test("family API requests the complete single-month/currency type list with exact counts", async () => {
  const record = {
    ...row("FINANCES", "COUPON_FEES", "-6.53"),
    month: "2026-07-01",
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    currency: "USD",
    row_count: "2",
  };
  const client = createApiClient(SETTINGS, async (url, init) => {
    if (new URL(url).pathname.endsWith("/workspace_revisions"))
      return new Response(JSON.stringify({ revisions: { finances: "f1", data_kiosk: "k1" } }), {
        headers: { "Content-Type": "application/json" },
      });
    const params = new URL(url).searchParams;
    assert.equal(params.get("p_month_from"), "2026-07-01");
    assert.equal(params.get("p_month_to"), "2026-08-01");
    assert.equal(params.get("p_currency"), "USD");
    assert.equal(params.get("p_marketplace"), "Amazon.com");
    assert.equal(params.get("limit"), "1000");
    assert.equal(params.get("offset"), "0");
    assert.equal(params.get("order"), "month.asc,source.asc,component_type.asc");
    assert.equal(init.headers.Prefer, "count=exact");
    return new Response(csvRecord(record), { headers: { "Content-Range": "0-0/1" } });
  });
  assert.equal(
    (
      await client.fetchFinancialReviewFamilyTypes(
        "access",
        "DATA_KIOSK",
        "2026-07",
        "USD",
        "Amazon.com",
      )
    ).rows[0].amount,
    "-6.53",
  );
});

test("family API rejects truncated or differently scoped responses", async () => {
  const record = {
    ...row("FINANCES", "COUPON_FEES", "-6.53"),
    month: "2026-07-01",
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    currency: "USD",
    row_count: "2",
  };
  for (const body of [
    csvRecord({ ...record, currency: "EUR" }),
    csvRecord({ ...record, marketplace_name: "Amazon.ca" }),
    csvRecord(record).split("\n")[0] +
      "\n" +
      Array(1000).fill(csvRecord(record).split("\n")[1]).join("\n"),
  ]) {
    const client = createApiClient(SETTINGS, async (url) =>
      new URL(url).pathname.endsWith("/workspace_revisions")
        ? new Response(JSON.stringify({ revisions: { finances: "f1", data_kiosk: "k1" } }), {
            headers: { "Content-Type": "application/json" },
          })
        : new Response(body, { headers: { "Content-Range": "0-0/1" } }),
    );
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes(
        "access",
        "DATA_KIOSK",
        "2026-07",
        "USD",
        "Amazon.com",
      ),
    );
  }
});

test("unavailable saved family IDs remain selected and strict amounts never broaden their scope", () => {
  const sourceUnknown = resolveTypeFamily("FINANCES", "FUTURE_FEE").id;
  assert.deepEqual(unavailableTypeFamilyIds([sourceUnknown, "monthly-storage"]), []);
  for (const selected of [
    ["refund-commission"],
    ["inbound-transportation-program", "monthly-storage"],
    ["monthly-storage", "refund-commission", sourceUnknown],
  ]) {
    const normalized = normalizeTypeFamilyIds([...selected, ...selected, null, ""]);
    assert.deepEqual(normalized, [...selected].sort());
    assert.ok(unavailableTypeFamilyIds(normalized).length > 0);
    assert.throws(() => typeFamilyTypeSelections(normalized));
    assert.throws(() => buildFinancialReviewFamilyMonths([], normalized));
    assert.throws(() => buildFinancialReviewFamilies([], normalized));
  }
});
