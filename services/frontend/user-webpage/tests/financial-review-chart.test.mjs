import assert from "node:assert/strict";
import test from "node:test";
import { projectFinancialReviewChart } from "../src/financial-review-chart.ts";
import { formatFinancialReviewChartTick } from "../src/financial-review-chart-format.ts";
import {
  buildFinancialReviewFamilySeries,
  feeFamilyVisual,
} from "../src/financial-review-family-series.ts";

const overview = (month, difference, running_difference, overrides = {}) => ({
  month: `${month}-01`,
  category: "DATA_KIOSK",
  currency: "USD",
  difference,
  running_difference,
  ...overrides,
});
const typeRow = (month, component_type, amount, source = "FINANCES", category = "DATA_KIOSK") => ({
  month: `${month}-01`,
  category,
  currency: "USD",
  source,
  component_type,
  amount,
  row_count: "1",
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);

test("family series anchor to observed months, carry absent families, and retain exact chronological values", () => {
  const types = Object.freeze([
    Object.freeze(typeRow("2026-01", "STORAGE_FEES", "1.000000009")),
    Object.freeze(typeRow("2026-01", "ADVERTISING", "-2")),
    Object.freeze(typeRow("2026-03", "STORAGE_FEES", "3")),
    Object.freeze(typeRow("2026-04", "ADVERTISING", "4")),
  ]);
  const rows = Object.freeze([
    Object.freeze(overview("2026-04", "4", "6.000000009")),
    Object.freeze(overview("2026-01", "-0.999999991", "-0.999999991")),
    Object.freeze(overview("2026-03", "3", "2.000000009")),
  ]);
  const series = buildFinancialReviewFamilySeries(types, rows);
  assert.deepEqual(
    series.map((family) => family.id),
    ["monthly-storage", "sponsored-products"],
  );
  assert.deepEqual(series[0].points, [
    { month: "2026-01-01", difference: "1.000000009", runningDifference: "1.000000009" },
    { month: "2026-03-01", difference: "3", runningDifference: "4.000000009" },
    { month: "2026-04-01", difference: "0", runningDifference: "4.000000009" },
  ]);
  assert.deepEqual(series[1].points, [
    { month: "2026-01-01", difference: "-2", runningDifference: "-2" },
    { month: "2026-03-01", difference: "0", runningDifference: "-2" },
    { month: "2026-04-01", difference: "4", runningDifference: "2" },
  ]);
  const chart = projectFinancialReviewChart(rows, series);
  assert.equal(chart.months.length, 4);
  assert.equal(chart.months[1], null);
  assert.equal(chart.lines.length, 2);
  for (const family of chart.families) assert.equal(family.lines.length, 2);
  assert.equal(chart.months[0].row, rows[1]);
  assert.equal(chart.months[0].segments[0].difference, "1.000000009");
  assert.equal(rows[0].month, "2026-04-01");
});

test("source months outside overview anchors stay gaps and do not create an invented running balance", () => {
  const types = [
    typeRow("2026-01", "STORAGE_FEES", "2"),
    typeRow("2026-02", "STORAGE_FEES", "100"),
    typeRow("2026-03", "STORAGE_FEES", "3"),
  ];
  const rows = [overview("2026-01", "2", "2"), overview("2026-03", "3", "5")];
  const series = buildFinancialReviewFamilySeries(types, rows);
  assert.deepEqual(
    series[0].points.map((point) => point.runningDifference),
    ["2", "5"],
  );
  assert.equal(projectFinancialReviewChart(rows, series).months[1], null);
});

test("monthly positive and negative families stack separately even when their net cancels to zero", () => {
  const rows = [overview("2026-01", "0", "0")];
  const series = buildFinancialReviewFamilySeries(
    [
      typeRow("2026-01", "STORAGE_FEES", "10"),
      typeRow("2026-01", "ADVERTISING", "-5"),
      typeRow("2026-01", "DEAL_FEES", "3"),
      typeRow("2026-01", "AGED_STORAGE_FEES", "-8"),
    ],
    rows,
  );
  const chart = projectFinancialReviewChart(rows, series);
  close(chart.zero, 50);
  const segments = chart.months[0].segments;
  const positive = segments.filter((segment) => !segment.difference.startsWith("-"));
  const negative = segments.filter((segment) => segment.difference.startsWith("-"));
  assert.equal(positive.length, 2);
  assert.equal(negative.length, 2);
  for (const segment of positive) {
    assert.ok(segment.top < chart.zero);
    assert.ok(segment.top + segment.height <= chart.zero + 1e-10);
  }
  for (const segment of negative) {
    assert.ok(segment.top >= chart.zero);
    assert.ok(segment.top + segment.height > chart.zero);
  }
  close(positive[0].top + positive[0].height, chart.zero);
  close(positive[1].top + positive[1].height, positive[0].top);
  close(negative[0].top, chart.zero);
  close(negative[1].top, negative[0].top + negative[0].height);
  close(Math.min(...positive.map((segment) => segment.top)), (0.12 / 1.24) * 100);
  assert.equal(chart.months[0].row.difference, "0");
});

test("shared scale contains every family running amount and the total running amount", () => {
  const balancedRows = [overview("2026-01", "0", "0"), overview("2026-02", "0", "0")];
  const balanced = buildFinancialReviewFamilySeries(
    [
      typeRow("2026-01", "STORAGE_FEES", "100"),
      typeRow("2026-01", "ADVERTISING", "-100"),
      typeRow("2026-02", "STORAGE_FEES", "10"),
      typeRow("2026-02", "ADVERTISING", "-10"),
    ],
    balancedRows,
  );
  const balancedChart = projectFinancialReviewChart(balancedRows, balanced);
  const storageEnd = balancedChart.months[1].segments.find(
    (segment) => segment.familyId === "monthly-storage",
  );
  const storageStart = balancedChart.months[0].segments.find(
    (segment) => segment.familyId === "monthly-storage",
  );
  assert.ok(storageEnd.runningY < storageStart.top);
  assert.ok(storageEnd.runningY > 0);
  const rows = [overview("2026-01", "10", "10"), overview("2026-02", "10", "20")];
  const series = buildFinancialReviewFamilySeries(
    [
      typeRow("2026-01", "STORAGE_FEES", "6"),
      typeRow("2026-01", "ADVERTISING", "4"),
      typeRow("2026-02", "STORAGE_FEES", "6"),
      typeRow("2026-02", "ADVERTISING", "4"),
    ],
    rows,
  );
  const chart = projectFinancialReviewChart(rows, series);
  for (const segment of chart.months[1].segments)
    assert.ok(chart.months[1].runningY < segment.runningY);
  assert.ok(chart.months[1].runningY > 0);
});

test("zero families remain visible in series and large exact amounts are never rounded for labels", () => {
  const rows = [
    overview("2026-01", "9007199254740993.123456789", "9007199254740993.123456789"),
    overview("2026-02", "-9007199254740993.123456788", "0.000000001"),
  ];
  const types = [
    typeRow("2026-01", "STORAGE_FEES", "9007199254740993.123456789"),
    typeRow("2026-01", "ADVERTISING", "0"),
    typeRow("2026-02", "STORAGE_FEES", "-9007199254740993.123456788"),
  ];
  const series = buildFinancialReviewFamilySeries(types, rows);
  assert.deepEqual(
    series[1].points.map((point) => point.difference),
    ["0", "0"],
  );
  assert.equal(series[0].points[1].runningDifference, "0.000000001");
  const chart = projectFinancialReviewChart(rows, series);
  assert.equal(chart.months[1].segments[0].runningDifference, "0.000000001");
  assert.equal(chart.months[0].segments[1].height, 0);
  assert.equal(chart.months[0].row.difference, "9007199254740993.123456789");
});

test("selection uses stable family identities and colors independent of order or year", () => {
  const common = [
    "monthly-storage",
    "aged-storage",
    "sponsored-products",
    "coupons",
    "deals",
    "disposal",
    "removal",
    "labeling",
    "inbound-transportation",
  ];
  assert.equal(new Set(common.map((id) => feeFamilyVisual(id).color)).size, common.length);
  assert.equal(new Set(common.map((id) => feeFamilyVisual(id).dash)).size, common.length);
  assert.deepEqual(feeFamilyVisual("monthly-storage"), { color: "#2563eb", dash: "" });
  const selected = buildFinancialReviewFamilySeries(
    [typeRow("2026-01", "STORAGE_FEES", "2"), typeRow("2026-01", "ADVERTISING", "3")],
    [overview("2026-01", "2", "2")],
    ["monthly-storage", "aged-storage"],
  );
  assert.deepEqual(
    selected.map((family) => family.id),
    ["aged-storage", "monthly-storage"],
  );
  assert.deepEqual(selected[0].points, [
    { month: "2026-01-01", difference: "0", runningDifference: "0" },
  ]);
  const nextYear = buildFinancialReviewFamilySeries(
    [typeRow("2027-05", "STORAGE_FEES", "7")],
    [overview("2027-05", "7", "7")],
  );
  assert.equal(selected[1].color, nextYear[0].color);
  assert.equal(selected[1].dash, nextYear[0].dash);
  const futureId = "source:FINANCES:FUTURE_FEE";
  const before = feeFamilyVisual(futureId);
  for (const id of common.toReversed()) feeFamilyVisual(id);
  assert.deepEqual(feeFamilyVisual(futureId), before);
  before.color = "changed";
  assert.notEqual(feeFamilyVisual(futureId).color, "changed");
});

test("source-only family colors derive from identity and remain stable when selected alone", () => {
  const types = [
    typeRow("2026-01", "EPR_FEES", "10", "FINANCES", "SELBOX"),
    typeRow("2026-01", "MCF_CREDITS", "2", "FINANCES", "SELBOX"),
  ];
  const rows = [overview("2026-01", "12", "12", { category: "SELBOX" })];
  const all = buildFinancialReviewFamilySeries(types, rows);
  assert.notEqual(all[0].color, all[1].color);
  for (const family of all) {
    assert.match(family.color, /^hsl\(\d+ \d+% \d+%\)$/);
    const selected = buildFinancialReviewFamilySeries(types.toReversed(), rows, [family.id]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].color, family.color);
    assert.equal(selected[0].dash, family.dash);
    assert.deepEqual(feeFamilyVisual(family.id), { color: family.color, dash: family.dash });
  }
});

test("family projection rejects inconsistent totals without changing the aggregate-only fallback", () => {
  const rows = [overview("2026-01", "3", "3")];
  const types = [typeRow("2026-01", "STORAGE_FEES", "2")];
  const series = buildFinancialReviewFamilySeries(types, rows);
  assert.equal(projectFinancialReviewChart(rows, series), null);
  assert.ok(projectFinancialReviewChart(rows));
  const correctRows = [overview("2026-01", "2", "2")];
  assert.ok(projectFinancialReviewChart(correctRows, series));
  const wrongRunning = structuredClone(series);
  wrongRunning[0].points[0].runningDifference = "1";
  assert.equal(projectFinancialReviewChart(correctRows, wrongRunning), null);
  assert.equal(projectFinancialReviewChart(correctRows, [...series, ...series]), null);
  assert.equal(projectFinancialReviewChart(correctRows, [{ ...series[0], points: [] }]), null);
  assert.equal(projectFinancialReviewChart(rows, []), null);
});

test("source-only chart markers reflect registry definitions rather than missing observed rows", () => {
  const rows = [overview("2026-01", "3", "3", { category: "FINANCES" })];
  const series = buildFinancialReviewFamilySeries(
    [
      typeRow("2026-01", "SHIPPING_CREDITS", "10", "FINANCES", "FINANCES"),
      typeRow("2026-01", "NET_PRODUCT_SALES", "8", "DATA_KIOSK", "FINANCES"),
      typeRow("2026-01", "PRODUCT_SALES", "1", "FINANCES", "FINANCES"),
    ],
    rows,
  );
  const chart = projectFinancialReviewChart(rows, series);
  for (const families of [series, chart.families]) {
    assert.equal(
      families.find((family) => family.id === "shipping").sourceOnlyLabel,
      "Finances only",
    );
    assert.equal(
      families.find((family) => family.id === "net-product-sales").sourceOnlyLabel,
      undefined,
    );
  }
  assert.equal(chart.months[0].row.difference, "3");
  const kioskOnly = buildFinancialReviewFamilySeries(
    [
      typeRow("2026-01", "SPONSORED_BRANDS", "8", "DATA_KIOSK"),
      typeRow("2026-01", "STORAGE_FEES", "1"),
    ],
    [overview("2026-01", "-7", "-7")],
  );
  assert.equal(
    kioskOnly.find((family) => family.id === "sponsored-brands").sourceOnlyLabel,
    "Data Kiosk only",
  );
  assert.equal(
    kioskOnly.find((family) => family.id === "monthly-storage").sourceOnlyLabel,
    undefined,
  );
});

test("net sales plot one signed economic difference instead of separate opposing gross source lines", () => {
  const rows = [
    overview("2026-01", "0.000000008", "0.000000008", { category: "FINANCES" }),
    overview("2026-02", "0", "0.000000008", { category: "FINANCES" }),
  ];
  const types = [
    typeRow("2026-01", "PRODUCT_SALES", "100.000000009", "FINANCES", "FINANCES"),
    typeRow("2026-01", "PRODUCT_REFUNDS", "-20", "FINANCES", "FINANCES"),
    typeRow("2026-01", "ZERO_ACTIVITY", "0", "FINANCES", "FINANCES"),
    typeRow("2026-01", "NET_PRODUCT_SALES", "80.000000001", "DATA_KIOSK", "FINANCES"),
    typeRow("2026-02", "PRODUCT_SALES", "5", "FINANCES", "FINANCES"),
    typeRow("2026-02", "PRODUCT_REFUNDS", "-5", "FINANCES", "FINANCES"),
    typeRow("2026-02", "ZERO_ACTIVITY", "0", "FINANCES", "FINANCES"),
    typeRow("2026-02", "NET_PRODUCT_SALES", "0", "DATA_KIOSK", "FINANCES"),
  ];
  for (const ids of [
    [],
    ["net-product-sales"],
    ["product-sales", "product-refunds", "zero-activity"],
  ]) {
    const series = buildFinancialReviewFamilySeries(types, rows, ids);
    assert.equal(series.length, 1);
    assert.equal(series[0].id, "net-product-sales");
    assert.equal(series[0].sourceOnlyLabel, undefined);
    assert.deepEqual(series[0].points, [
      { month: "2026-01-01", difference: "0.000000008", runningDifference: "0.000000008" },
      { month: "2026-02-01", difference: "0", runningDifference: "0.000000008" },
    ]);
    const chart = projectFinancialReviewChart(rows, series);
    assert.equal(chart.families.length, 1);
    assert.equal(chart.months[0].segments.length, 1);
    assert.equal(chart.months[1].segments[0].difference, "0");
    assert.equal(chart.months[1].row, rows[1]);
  }
});

test("unprojectable amounts and invalid months return null while exact family values remain available", () => {
  const rows = [overview("2026-01", "0", "0")];
  const series = buildFinancialReviewFamilySeries(
    [typeRow("2026-01", "STORAGE_FEES", "1e400"), typeRow("2026-01", "ADVERTISING", "-1e400")],
    rows,
  );
  assert.equal(series[0].points[0].difference, "1" + "0".repeat(400));
  assert.equal(projectFinancialReviewChart(rows, series), null);
  assert.ok(projectFinancialReviewChart(rows));
  for (const badRows of [
    [],
    [overview("2026-01", "1e400", "1e400")],
    [overview("2026-01", null, "1")],
    [overview("2026-13", "1", "1")],
    [overview("2026-01", "1", "1", { month: "2026-01-02" })],
    [overview("2026-01", "1", "1"), overview("2026-01", "2", "3")],
    [overview("2026-01", "1", "1"), overview("2027-01", "2", "3")],
  ])
    assert.equal(projectFinancialReviewChart(badRows), null);
});

test("family series reject mixed scopes and malformed inputs instead of combining years or currencies", () => {
  const rows = [overview("2026-01", "2", "2")];
  const types = [typeRow("2026-01", "STORAGE_FEES", "2")];
  for (const invalidTypes of [
    [{ ...types[0], currency: "EUR" }],
    [{ ...types[0], category: "SELBOX" }],
    [typeRow("2027-01", "STORAGE_FEES", "2")],
    [{ ...types[0], amount: null }],
    [types[0], types[0]],
  ])
    assert.throws(() => buildFinancialReviewFamilySeries(invalidTypes, rows));
  for (const invalidRows of [
    [rows[0], rows[0]],
    [rows[0], overview("2027-02", "2", "4")],
    [rows[0], overview("2026-02", "2", "4", { currency: "EUR" })],
  ])
    assert.throws(() => buildFinancialReviewFamilySeries(types, invalidRows));
  assert.throws(() => buildFinancialReviewFamilySeries(types, rows, ["invalid-id"]));
  assert.deepEqual(buildFinancialReviewFamilySeries(types, []), []);
});

test("magnitude ticks retain exact domain extents and avoid overlapping zero", () => {
  const chart = projectFinancialReviewChart([
    overview("2026-01", "9007199254740993.123456789", "9007199254740993.123456789"),
    overview("2026-02", "-9007199254740993.123456788", "0.000000001"),
  ]);
  assert.deepEqual(
    chart.ticks.map((tick) => tick.value),
    ["9007199254740993.123456789", "0", "-9007199254740993.123456788"],
  );
  const asymmetric = projectFinancialReviewChart([
    overview("2026-01", "0.01", "0.01"),
    overview("2026-02", "-6021.18", "-6021.17"),
  ]);
  assert.deepEqual(
    asymmetric.ticks.map((tick) => tick.value),
    ["0", "-6021.18"],
  );
  assert.deepEqual(projectFinancialReviewChart([overview("2026-01", "0", "0")]).ticks, [
    { value: "0", y: 50 },
  ]);
});

test("compact magnitude labels round decimal digits without floating financial arithmetic", () => {
  for (const [value, label] of [
    ["0", "0"],
    ["-6021.17", "-6.02k"],
    ["3035962", "3.04M"],
    ["9007199254740993.123456789", "9.01e15"],
    ["0.000009", "9e-6"],
    ["-0.0025001", "-2.5e-3"],
    ["10.5", "10.5"],
    ["999.995", "1,000"],
  ])
    assert.equal(formatFinancialReviewChartTick(value), label);
  assert.throws(() => formatFinancialReviewChartTick("invalid"));
});
