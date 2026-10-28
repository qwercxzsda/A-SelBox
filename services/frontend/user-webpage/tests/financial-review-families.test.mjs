import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFinancialReviewFamilies,
  buildFinancialReviewFamilyMonths,
} from "../src/financial-review-families.ts";
import {
  buildFeeFamilyOptions,
  feeFamilyTypeSelections,
  normalizeFeeFamilyIds,
  resolveFeeFamily,
  FEE_FAMILIES,
} from "../src/fee-family-catalog.ts";
import { sumExactDecimals } from "../src/decimal.ts";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";
const row = (source, component_type, amount, overrides = {}) => ({
  source,
  component_type,
  amount,
  month: "2026-07-01",
  category: "DATA_KIOSK",
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
      "Monthly storage",
      "STORAGE_FEES",
      ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
    ],
    [
      "aged-storage",
      "Aged storage",
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
    assert.equal(resolveFeeFamily("FINANCES", financesType).id, id);
    const result = buildFinancialReviewFamilies([
      row("FINANCES", financesType, "-10"),
      ...kioskTypes.map((type) => row("DATA_KIOSK", type, "-1.25")),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].family_id, id);
    assert.equal(result[0].family, label);
    assert.equal(result[0].coverage, "Both sources");
    assert.equal(result[0].data_kiosk_amount, sumExactDecimals(kioskTypes.map(() => "-1.25")));
    for (const type of kioskTypes) assert.equal(resolveFeeFamily("DATA_KIOSK", type).id, id);
  }
});

test("Sponsored Brands and Display aliases stay separate from Products and each other", () => {
  for (const [type, id] of [
    ["BRANDS", "sponsored-brands"],
    ["DISPLAY", "sponsored-display"],
  ]) {
    for (const suffix of ["", "_CHARGE", "_CHARGES"]) {
      const family = resolveFeeFamily("DATA_KIOSK", `SPONSORED_${type}${suffix}`);
      assert.equal(family.id, id);
      assert.deepEqual(family.financesTypes, []);
    }
  }
  assert.notEqual(
    resolveFeeFamily("FINANCES", "INBOUND_TRANSPORTATION_FEES").id,
    resolveFeeFamily("FINANCES", "INBOUND_TRANSPORTATION_PROGRAM_FEES").id,
  );
});

test("every supported monetary source type belongs to one explicit family", () => {
  const memberships = FEE_FAMILIES.flatMap((family) => [
    ...family.financesTypes.map((type) => ["FINANCES", type, family.id]),
    ...family.dataKioskTypes.map((type) => ["DATA_KIOSK", type, family.id]),
  ]);
  assert.equal(new Set(FEE_FAMILIES.map((family) => family.id)).size, FEE_FAMILIES.length);
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
    const family = resolveFeeFamily(source, type);
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
  assert.notEqual(
    resolveFeeFamily("FINANCES", "PRODUCT_SALES").id,
    resolveFeeFamily("DATA_KIOSK", "NET_PRODUCT_SALES").id,
  );
  assert.notEqual(
    resolveFeeFamily("FINANCES", "LIQUIDATION_FEES").id,
    resolveFeeFamily("DATA_KIOSK", "LIQUIDATION_PROCESSING_FEE").id,
  );
  assert.deepEqual(buildFinancialReviewFamilies([]), []);
  assert.deepEqual(buildFinancialReviewFamilyMonths([]), []);
});

test("native inbound convenience fees pair without including placement service fees", () => {
  assert.equal(resolveFeeFamily("FINANCES", "INBOUND_PLACEMENT_FEES").id, "inbound-convenience");
  assert.equal(
    resolveFeeFamily("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE").id,
    "inbound-convenience",
  );
  assert.deepEqual(feeFamilyTypeSelections(["inbound-convenience"]), {
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
  const placement = result.find((item) => item.family_id === "data-kiosk-inbound-placement");
  assert.equal(placement.coverage, "Data Kiosk-only family");
  assert.equal(placement.data_kiosk_amount, "-10");
});

test("family selections preserve exact source-qualified types and reject malformed IDs", () => {
  const rawType = 'Future / "fee",(test): % + 日本語';
  const unknown = resolveFeeFamily("FINANCES", rawType);
  const selection = feeFamilyTypeSelections(["monthly-storage", unknown.id, "monthly-storage"]);
  assert.deepEqual(selection, {
    financesTypes: ["STORAGE_FEES", rawType],
    dataKioskTypes: ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
  });
  assert.deepEqual(feeFamilyTypeSelections(["sponsored-brands"]), {
    financesTypes: [],
    dataKioskTypes: ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  });
  assert.equal(feeFamilyTypeSelections([]), null);
  assert.deepEqual(
    normalizeFeeFamilyIds([unknown.id, null, "missing-id", "monthly-storage", unknown.id]),
    ["monthly-storage", unknown.id],
  );
  assert.deepEqual(normalizeFeeFamilyIds("monthly-storage"), []);
  for (const value of [
    null,
    [null],
    ["missing-id"],
    ["source:OTHER:X"],
    ["source:FINANCES:%"],
    ["source:FINANCES:STORAGE_FEES"],
    ["source:FINANCES:%00"],
  ]) {
    assert.throws(() => feeFamilyTypeSelections(value));
    assert.throws(() => buildFinancialReviewFamilyMonths([], value));
  }
  assert.throws(() => resolveFeeFamily("SETTLEMENT", "STORAGE_FEES"));
  assert.throws(() => resolveFeeFamily("FINANCES", ""));
});

test("family options include observed identities and retain selected families with no current rows", () => {
  const rows = [
    row("FINANCES", "ADVERTISING", "0"),
    row("DATA_KIOSK", "SPONSORED_PRODUCTS", "0"),
    row("DATA_KIOSK", "FUTURE_FEE", "0"),
  ];
  const options = buildFeeFamilyOptions(rows, ["aged-storage"]);
  assert.deepEqual(
    new Set(options.map((item) => item.id)),
    new Set(["aged-storage", "sponsored-products", "source:DATA_KIOSK:FUTURE_FEE"]),
  );
  assert.equal(options.length, 3);
  assert.deepEqual(buildFeeFamilyOptions([]), []);
  assert.throws(() => buildFeeFamilyOptions([], ["bad"]));
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
    currency: "USD",
    row_count: "2",
  };
  const client = createApiClient(SETTINGS, async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("p_month_from"), "2026-07-01");
    assert.equal(params.get("p_month_to"), "2026-08-01");
    assert.equal(params.get("p_currency"), "USD");
    assert.equal(params.get("limit"), "1000");
    assert.equal(params.get("offset"), "0");
    assert.equal(params.get("order"), "month.asc,source.asc,component_type.asc");
    assert.equal(init.headers.Prefer, "count=exact");
    return new Response(csvRecord(record), { headers: { "Content-Range": "0-0/1" } });
  });
  assert.equal(
    (await client.fetchFinancialReviewFamilyTypes("access", "DATA_KIOSK", "2026-07", "USD"))[0]
      .amount,
    "-6.53",
  );
});

test("family API rejects truncated or differently scoped responses", async () => {
  const record = {
    ...row("FINANCES", "COUPON_FEES", "-6.53"),
    month: "2026-07-01",
    category: "DATA_KIOSK",
    currency: "USD",
    row_count: "2",
  };
  for (const body of [
    csvRecord({ ...record, currency: "EUR" }),
    csvRecord(record).split("\n")[0] +
      "\n" +
      Array(1000).fill(csvRecord(record).split("\n")[1]).join("\n"),
  ]) {
    const client = createApiClient(
      SETTINGS,
      async () => new Response(body, { headers: { "Content-Range": "0-0/1" } }),
    );
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", "DATA_KIOSK", "2026-07", "USD"),
    );
  }
});
