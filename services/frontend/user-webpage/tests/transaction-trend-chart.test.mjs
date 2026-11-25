import assert from "node:assert/strict";
import test from "node:test";
import {
  transactionTrendPoints,
  projectTransactionTrend,
  transactionTrendDateLabel,
  transactionTrendShortLabel,
} from "../src/transaction-trend-chart.ts";

const row = (periodStart, type, companyAmount, overrides = {}) => ({
  periodStart,
  type,
  companyAmount,
  reportedAmount: companyAmount,
  serviceFee: companyAmount === null ? null : "0",
  rowCount: 1,
  missingFeeCount: 0,
  ...overrides,
});

test("daily chart uses broad groups, exact period totals, and no accumulated total", () => {
  const rows = [
    row("2026-11-13", "PRODUCT_SALES", "20"),
    row("2026-11-14", "PRODUCT_SALES", "95.000000009"),
    row("2026-11-14", "STORAGE_FEES", "-10"),
    row("2026-11-14", "PROMOTIONAL_REBATES", "-5"),
    row("2026-11-14", "SHIPPING_CREDITS", "1"),
  ];
  const points = transactionTrendPoints(rows, "day", { from: "2026-11-12", to: "2026-11-14" });
  assert.deepEqual(
    points.map((point) => point.companyAmount),
    ["0", "20", "81.000000009"],
  );
  assert.deepEqual(
    points[2].groups.map((group) => [group.id, group.companyAmount]),
    [
      ["sales", "95.000000009"],
      ["fulfillment", "1"],
      ["inventory", "-10"],
      ["advertising", "-5"],
    ],
  );
  assert.equal(points[0].rowCount, 0);
  const chart = projectTransactionTrend(points);
  assert.equal(chart.lines.length, 1);
  assert.deepEqual(
    chart.points.map((point) => point.amount),
    ["0", "20", "81.000000009"],
  );
  assert.equal(chart.lines[0].split(" ").length, 3);
  assert.ok(chart.points[2].lineY < chart.points[1].lineY);
});

test("unknown amounts stay unknown, partial totals remain known subtotals, and the line breaks only across unknown buckets", () => {
  const points = transactionTrendPoints(
    [
      row("2026-11-12", "PRODUCT_SALES", "5"),
      row("2026-11-13", "PRODUCT_SALES", null, { missingFeeCount: 1 }),
      row("2026-11-14", "PRODUCT_SALES", "20"),
      row("2026-11-14", "STORAGE_FEES", null, { missingFeeCount: 1 }),
    ],
    "day",
    { from: "2026-11-11", to: "2026-11-15" },
  );
  assert.deepEqual(
    points.map((point) => point.companyAmount),
    ["0", "5", null, "20", "0"],
  );
  assert.equal(points[2].groups.find((group) => group.id === "sales").companyAmount, null);
  assert.equal(points[3].groups.find((group) => group.id === "inventory").companyAmount, null);
  assert.equal(points[3].missingFeeCount, 1);
  const chart = projectTransactionTrend(points);
  assert.equal(chart.points[2].lineY, null);
  assert.equal(chart.lines.length, 2);
});

test("weekly charts use Monday buckets, span years, and clip labels to actual selected dates", () => {
  const points = transactionTrendPoints(
    [row("2025-12-29", "PRODUCT_SALES", "10"), row("2026-01-12", "PRODUCT_SALES", "25")],
    "week",
    { from: "2026-01-01", to: "2026-01-14" },
  );
  assert.deepEqual(
    points.map((point) => [point.periodStart, point.from, point.to, point.companyAmount]),
    [
      ["2025-12-29", "2026-01-01", "2026-01-04", "10"],
      ["2026-01-05", "2026-01-05", "2026-01-11", "0"],
      ["2026-01-12", "2026-01-12", "2026-01-14", "25"],
    ],
  );
  assert.equal(transactionTrendDateLabel(points[0]), "2026-01-01 – 2026-01-04");
  assert.equal(projectTransactionTrend(points).points[2].amount, "25");
});

test("unknown types use Other; large decimal labels remain exact when plotting cannot represent them", () => {
  const points = transactionTrendPoints([row("2026-11-14", "UNRECOGNIZED_FEE", "1e400")], "day", {
    from: "2026-11-14",
    to: "2026-11-14",
  });
  assert.equal(points[0].groups[0].id, "other");
  assert.equal(points[0].companyAmount, "1" + "0".repeat(400));
  assert.equal(projectTransactionTrend(points), null);
});

test("open-ended bounds follow actual data and invalid bucket dates are rejected", () => {
  const rows = [row("2026-11-12", "PRODUCT_SALES", "2"), row("2026-11-14", "PRODUCT_SALES", "3")];
  assert.equal(transactionTrendPoints(rows, "day", { from: "", to: "" }).length, 3);
  assert.deepEqual(transactionTrendPoints([], "day", { from: "", to: "" }), []);
  assert.throws(
    () => transactionTrendPoints(rows, "week", { from: "2026-11-12", to: "2026-11-14" }),
    /granularity/,
  );
  assert.throws(
    () => transactionTrendPoints(rows, "day", { from: "2026-11-13", to: "2026-11-14" }),
    /outside/,
  );
});

test("open-ended weekly ranges include the entire last bucket for labels and drilldowns", () => {
  const points = transactionTrendPoints([row("2026-11-09", "PRODUCT_SALES", "40")], "week", {
    from: "2026-11-11",
    to: "",
  });
  assert.equal(points[0].from, "2026-11-11");
  assert.equal(points[0].to, "2026-11-15");
});

test("stacked broad-group bars keep their signs with just one period-total line", () => {
  const points = transactionTrendPoints(
    [row("2026-11-14", "PRODUCT_SALES", "95"), row("2026-11-14", "STORAGE_FEES", "-10")],
    "day",
    { from: "2026-11-14", to: "2026-11-14" },
  );
  const chart = projectTransactionTrend(points);
  assert.equal(chart.points[0].amount, "85");
  assert.equal(chart.lines.length, 1);
  assert.ok(chart.groups.every((group) => group.lines.length === 0));
  assert.ok(chart.points[0].segments.every((segment) => segment.lineY === null));
  const sales = chart.points[0].segments.find((segment) => segment.familyId === "sales");
  const storage = chart.points[0].segments.find((segment) => segment.familyId === "inventory");
  assert.ok(sales.top < chart.zero);
  assert.equal(storage.top, chart.zero);
});

test("very large date ranges request a narrower range without silently dropping periods", () => {
  assert.throws(
    () => transactionTrendPoints([], "day", { from: "0001-01-01", to: "9999-12-31" }),
    /shorter date range/,
  );
});

test("all three amounts remain independently exact for each period and broad group", () => {
  const points = transactionTrendPoints(
    [
      row("2026-11-13", "PRODUCT_SALES", "0.9950000000000000001", {
        reportedAmount: "1.0050000000000000001",
        serviceFee: "-0.01",
      }),
      row("2026-11-13", "PRODUCT_REFUNDS", "-0.4750000000000000001", {
        reportedAmount: "-0.5000000000000000001",
        serviceFee: "0.025",
      }),
      row("2026-11-13", "STORAGE_FEES", "-0.52"),
      row("2026-11-14", "PRODUCT_SALES", "-2", { reportedAmount: "10", serviceFee: "-12" }),
    ],
    "day",
    { from: "2026-11-12", to: "2026-11-14" },
  );
  const values = ({ reportedAmount, serviceFee, companyAmount }) => [
    reportedAmount,
    serviceFee,
    companyAmount,
  ];
  assert.deepEqual(points.map(values), [
    ["0", "0", "0"],
    ["-0.015", "0.015", "0"],
    ["10", "-12", "-2"],
  ]);
  assert.deepEqual(values(points[1].groups.find((group) => group.id === "sales")), [
    "0.505",
    "0.015",
    "0.52",
  ]);
  assert.deepEqual(values(points[0].groups[0]), ["0", "0", "0"]);
  assert.equal(points[0].rowCount, 0);
  assert.equal(points[1].rowCount, 3);
  assert.ok(
    points.every(
      (point) =>
        !Object.hasOwn(point, "amount") &&
        point.groups.every((group) => !Object.hasOwn(group, "amount")),
    ),
  );
  const chart = projectTransactionTrend(points);
  assert.deepEqual(
    chart.points.map((point) => point.amount),
    ["0", "0", "-2"],
  );
});

test("known reported amounts survive missing fees while fee and company totals stay unknown", () => {
  const points = transactionTrendPoints(
    [
      row("2026-11-13", "PRODUCT_SALES", null, {
        reportedAmount: "100",
        serviceFee: null,
        missingFeeCount: 1,
      }),
      row("2026-11-14", "PRODUCT_SALES", "95", { reportedAmount: "100", serviceFee: "-5" }),
      row("2026-11-14", "STORAGE_FEES", null, {
        reportedAmount: "-10",
        serviceFee: null,
        missingFeeCount: 1,
      }),
    ],
    "day",
    { from: "2026-11-13", to: "2026-11-15" },
  );
  assert.equal(points[0].reportedAmount, "100");
  assert.equal(points[0].serviceFee, null);
  assert.equal(points[0].companyAmount, null);
  assert.equal(points[0].missingFeeCount, 1);
  assert.equal(points[1].reportedAmount, "90");
  assert.equal(points[1].serviceFee, "-5");
  assert.equal(points[1].companyAmount, "95");
  assert.equal(points[1].missingFeeCount, 1);
  assert.equal(points[1].groups.find((group) => group.id === "inventory").reportedAmount, "-10");
  assert.equal(points[1].groups.find((group) => group.id === "inventory").serviceFee, null);
  assert.equal(points[2].reportedAmount, "0");
  assert.equal(points[2].serviceFee, "0");
  assert.equal(points[2].companyAmount, "0");
  assert.equal(projectTransactionTrend(points).points[0].lineY, null);
});

test("trend period labels keep both YYYY-MM-DD boundaries across months and years", () => {
  assert.equal(transactionTrendShortLabel("2026-11-13"), "11-13");
  assert.equal(transactionTrendDateLabel({ from: "2026-11-13", to: "2026-11-13" }), "2026-11-13");
  assert.equal(
    transactionTrendDateLabel({ from: "2026-10-26", to: "2026-11-01" }),
    "2026-10-26 – 2026-11-01",
  );
  assert.equal(
    transactionTrendDateLabel({ from: "2025-12-29", to: "2026-01-04" }),
    "2025-12-29 – 2026-01-04",
  );
});

function chartForAmounts(reportedAmount, serviceFee, companyAmount, overrides = {}) {
  return projectTransactionTrend(
    transactionTrendPoints(
      [
        row("2026-11-14", "PRODUCT_SALES", companyAmount, {
          reportedAmount,
          serviceFee,
          ...overrides,
        }),
      ],
      "day",
      { from: "2026-11-14", to: "2026-11-14" },
    ),
  );
}

test("fee-bearing groups split into exact signed contributions with stable group-part identities", () => {
  const chart = chartForAmounts("100", "-5", "95");
  assert.equal(chart.points[0].amount, "95");
  assert.deepEqual(
    chart.points[0].segments.map(({ id, familyId, part, amount }) => ({
      id,
      familyId,
      part,
      amount,
    })),
    [
      { id: "sales:reported", familyId: "sales", part: "reported", amount: "100" },
      { id: "sales:serviceFee", familyId: "sales", part: "serviceFee", amount: "-5" },
    ],
  );
  const [reported, fee] = chart.points[0].segments;
  assert.ok(reported.top < chart.zero);
  assert.equal(fee.top, chart.zero);
  assert.ok(reported.height > 0 && fee.height > 0);
});

test("refund fees, fees larger than net, and exact cancellations use independent signed stacks", () => {
  const refund = chartForAmounts("-100", "5", "-95");
  assert.deepEqual(
    refund.points[0].segments.map(({ amount }) => amount),
    ["-100", "5"],
  );
  assert.equal(refund.points[0].segments[0].top, refund.zero);
  assert.ok(refund.points[0].segments[1].top < refund.zero);
  const largerFee = chartForAmounts("10", "-12", "-2");
  assert.deepEqual(
    largerFee.points[0].segments.map(({ amount }) => amount),
    ["10", "-12"],
  );
  assert.equal(largerFee.points[0].amount, "-2");
  const cancellation = chartForAmounts("0.000000000000000000123", "-0.000000000000000000123", "0");
  assert.deepEqual(
    cancellation.points[0].segments.map(({ amount }) => amount),
    ["0.000000000000000000123", "-0.000000000000000000123"],
  );
  assert.ok(cancellation.points[0].segments.every(({ height }) => height > 0));
  assert.equal(cancellation.points[0].amount, "0");
  assert.equal(cancellation.points[0].lineY, cancellation.zero);
});

test("partial company totals derive only known reported contributions without changing full reported details", () => {
  const partial = chartForAmounts("200", "-5", "95", { rowCount: 2, missingFeeCount: 1 });
  assert.equal(partial.points[0].reportedAmount, "200");
  assert.equal(partial.points[0].groups[0].reportedAmount, "200");
  assert.equal(partial.points[0].amount, "95");
  assert.deepEqual(
    partial.points[0].segments.map(({ amount }) => amount),
    ["100", "-5"],
  );
  assert.ok(partial.points[0].segments.every(({ missingFeeCount }) => missingFeeCount === 1));
  const unknown = chartForAmounts("100", null, null, { missingFeeCount: 1 });
  assert.deepEqual(unknown.points[0].segments, []);
  assert.equal(unknown.points[0].lineY, null);
  assert.equal(unknown.points[0].reportedAmount, "100");
});

test("zero or missing fees never fabricate a fee segment, while genuine zero activity stays available", () => {
  for (const fee of ["0", "-0.000", null]) {
    const chart = chartForAmounts("0", fee, "0");
    assert.equal(chart.points[0].rowCount, 1);
    assert.equal(chart.points[0].segments.length, 1);
    assert.equal(chart.points[0].segments[0].part, "reported");
    assert.equal(chart.points[0].segments[0].amount, "0");
    assert.equal(chart.points[0].lineY, chart.zero);
  }
});
