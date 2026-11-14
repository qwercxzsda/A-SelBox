import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinancialReviewTimeline,
  createMonthlyReviewView,
  createReviewScope,
  decodeMonthlyReviewView,
  decodeReviewScope,
  resolveReviewCurrency,
  resolveReviewYear,
} from "../src/financial-review-view.ts";

const row = (month, difference, currency = "USD") => ({
  month: `${month}-01`,
  marketplace_name: "Amazon.com",
  currency,
  difference,
  finances_amount: "100.004",
  data_kiosk_amount: "99.996",
});

test("year choices span source bounds while preserving an explicitly empty scope", () => {
  const bounds = { firstMonth: "2023-11", lastMonth: "2026-02" };
  assert.deepEqual(resolveReviewYear("", bounds), {
    year: "2026",
    years: ["2026", "2025", "2024", "2023"],
  });
  assert.deepEqual(resolveReviewYear("2028", bounds), {
    year: "2028",
    years: ["2028", "2026", "2025", "2024", "2023"],
  });
  assert.deepEqual(resolveReviewYear("", undefined), { year: "", years: [] });
  assert.deepEqual(resolveReviewYear("2025", { firstMonth: null, lastMonth: null }), {
    year: "2025",
    years: ["2025"],
  });
});

test("amount unit choices prefer observed USD automatically and never replace an explicit selection", () => {
  const rows = Object.freeze([
    row("2026-01", "1", "EUR"),
    row("2026-02", "2", "USD"),
    row("2026-03", "3", "EUR"),
  ]);
  assert.deepEqual(resolveReviewCurrency("", rows), {
    currency: "USD",
    currencies: ["EUR", "USD"],
  });
  assert.deepEqual(resolveReviewCurrency("JPY", rows), {
    currency: "JPY",
    currencies: ["EUR", "JPY", "USD"],
  });
  assert.deepEqual(resolveReviewCurrency("", [row("2026-01", "1", "EUR")]), {
    currency: "EUR",
    currencies: ["EUR"],
  });
  assert.deepEqual(resolveReviewCurrency("", []), { currency: "", currencies: [] });
  assert.deepEqual(resolveReviewCurrency("JPY", []), { currency: "JPY", currencies: ["JPY"] });
});

test("review scope persists marketplace with its amount unit and defaults to automatic currency", () => {
  assert.deepEqual(createReviewScope(), {
    year: "",
    marketplace: "Amazon.com",
    currency: "",
    families: [],
  });
  assert.deepEqual(decodeReviewScope(null), createReviewScope());
  assert.deepEqual(
    decodeReviewScope({
      year: "2024",
      marketplace: "Amazon.co.jp",
      currency: "JPY",
      rows: [row("2024-01", "999")],
    }),
    { year: "2024", marketplace: "Amazon.co.jp", currency: "JPY", families: [] },
  );
  for (const year of ["0001", "2026", "9999"])
    assert.deepEqual(decodeReviewScope({ year, marketplace: "Amazon.de", currency: "EUR" }), {
      year,
      marketplace: "Amazon.de",
      currency: "EUR",
      families: [],
    });
});

test("invalid persisted year or currency falls back independently without becoming a query filter", () => {
  for (const year of [null, 2026, "0000", "26", "02026", "2026-01", "2026,or=(id)"])
    assert.deepEqual(decodeReviewScope({ year, marketplace: "Amazon.co.jp", currency: "JPY" }), {
      year: "",
      marketplace: "Amazon.co.jp",
      currency: "JPY",
      families: [],
    });
  for (const currency of [null, 123, "", "usd", "USD,EUR", "US", "USD\0"])
    assert.deepEqual(decodeReviewScope({ year: "2026", marketplace: "Amazon.de", currency }), {
      year: "2026",
      marketplace: "Amazon.de",
      currency: "",
      families: [],
    });
});

test("missing or invalid marketplace scopes never infer a marketplace from currency", () => {
  for (const marketplace of [undefined, null, "", "Germany", "Amazon.de\0", 123]) {
    assert.deepEqual(
      decodeReviewScope({
        year: "2026",
        marketplace,
        currency: "EUR",
        families: ["monthly-storage"],
      }),
      {
        year: "2026",
        marketplace: "Amazon.com",
        currency: "",
        families: ["monthly-storage"],
      },
    );
  }
  for (const marketplace of ["Amazon.de", "Amazon.fr", "Non-Amazon DE", "Non-Amazon IT"]) {
    assert.deepEqual(decodeReviewScope({ marketplace, currency: "EUR" }), {
      year: "",
      marketplace,
      currency: "EUR",
      families: [],
    });
  }
  assert.equal(decodeReviewScope({ marketplace: "Amazon.de" }).currency, "");
  assert.equal(decodeReviewScope({ marketplace: "Amazon.de", currency: "JPY" }).currency, "JPY");
});

test("family scope keeps unavailable selections while discarding non-string saved values", () => {
  assert.deepEqual(
    decodeReviewScope({
      year: "2026",
      marketplace: "Amazon.com",
      currency: "USD",
      families: [
        "sponsored-products",
        "monthly-storage",
        "monthly-storage",
        "invented-family",
        null,
      ],
    }),
    {
      year: "2026",
      marketplace: "Amazon.com",
      currency: "USD",
      families: ["invented-family", "monthly-storage", "sponsored-products"],
    },
  );
});

test("monthly selection survives reload without retaining amounts or obsolete cursor state", () => {
  assert.deepEqual(createMonthlyReviewView(), { selectedMonth: null });
  assert.deepEqual(decodeMonthlyReviewView(null), createMonthlyReviewView());
  assert.deepEqual(decodeMonthlyReviewView({ selectedMonth: "2026-07", currency: "EUR" }), {
    selectedMonth: "2026-07",
    currency: "EUR",
  });
  for (const currency of [null, "", "eur", "EUR,USD", 123])
    assert.deepEqual(decodeMonthlyReviewView({ selectedMonth: "2026-07", currency }), {
      selectedMonth: "2026-07",
    });
  assert.deepEqual(
    decodeMonthlyReviewView({
      selectedMonth: "2024-09",
      pageIndex: 2,
      pageSize: 50,
      cursors: [null, { month: "2024-09", offset: 25 }],
      filterMonth: "2024-09",
      rows: [row("2024-09", "999")],
    }),
    { selectedMonth: "2024-09" },
  );
  for (const selectedMonth of [null, 202609, "2026-13", "2026-9", "2026-09-01", "0000-01"])
    assert.deepEqual(decodeMonthlyReviewView({ selectedMonth }), createMonthlyReviewView());
});

test("running difference includes each current month, preserves exact cancellation and source gaps, and never mutates rows", () => {
  const rows = Object.freeze([
    Object.freeze(row("2026-04", "0")),
    Object.freeze(row("2026-03", "-9007199254740993.123456788")),
    Object.freeze(row("2026-01", "9007199254740993.123456789")),
    Object.freeze(row("2026-02", "999", "JPY")),
  ]);
  const timeline = buildFinancialReviewTimeline(rows, "USD");
  assert.deepEqual(
    timeline.map(({ month }) => month),
    ["2026-01-01", "2026-03-01", "2026-04-01"],
  );
  assert.deepEqual(
    timeline.map(({ running_difference }) => running_difference),
    ["9007199254740993.123456789", "0.000000001", "0.000000001"],
  );
  assert.deepEqual(
    timeline.map(({ difference }) => difference),
    ["9007199254740993.123456789", "-9007199254740993.123456788", "0"],
  );
  assert.equal(timeline[0].finances_amount, "100.004");
  assert.equal(timeline[0].data_kiosk_amount, "99.996");
  assert.ok(rows.every((original) => !("running_difference" in original)));
  assert.equal(rows[0].month, "2026-04-01");
  assert.deepEqual(buildFinancialReviewTimeline(rows, "JPY")[0].running_difference, "999");
  assert.deepEqual(buildFinancialReviewTimeline(rows, "EUR"), []);
});

test("running amounts never round monthly values and each selected year starts without a prior balance", () => {
  assert.deepEqual(
    buildFinancialReviewTimeline([row("2026-01", "0.004"), row("2026-02", "0.004")], "USD").map(
      ({ running_difference }) => running_difference,
    ),
    ["0.004", "0.008"],
  );
  assert.equal(
    buildFinancialReviewTimeline([row("2027-01", "-2.005")], "USD")[0].running_difference,
    "-2.005",
  );
});

test("timeline rejects malformed months, duplicate months, mixed years and invalid differences", () => {
  for (const rows of [
    [{ ...row("2026-01", "1"), month: "2026-01-02" }],
    [{ ...row("2026-01", "1"), month: "2026-13-01" }],
    [{ ...row("2026-01", "1"), month: "2026-01-extra-01" }],
    [row("2026-01", "1"), row("2026-01", "2")],
    [row("2025-12", "1"), row("2026-01", "2")],
    [row("2026-01", undefined)],
    [row("2026-01", "")],
    [row("2026-01", "not-money")],
  ])
    assert.throws(() => buildFinancialReviewTimeline(rows, "USD"));
  assert.throws(() => buildFinancialReviewTimeline([], "usd"));
  assert.throws(
    () =>
      buildFinancialReviewTimeline(
        [
          { ...row("2026-01", "1", "EUR"), marketplace_name: "Amazon.de" },
          { ...row("2026-02", "2", "EUR"), marketplace_name: "Amazon.fr" },
        ],
        "EUR",
      ),
    /marketplace/,
  );
});

test("an unavailable comparison keeps later running differences unavailable", () => {
  assert.deepEqual(
    buildFinancialReviewTimeline(
      [row("2026-01", "1"), row("2026-02", null), row("2026-03", "3")],
      "USD",
    ).map(({ running_difference }) => running_difference),
    ["1", null, null],
  );
});

test("a removed-only saved family scope does not become the all-family scope", () => {
  assert.deepEqual(decodeReviewScope({ families: ["refund-commission"] }).families, [
    "refund-commission",
  ]);
  assert.deepEqual(
    decodeReviewScope({ families: ["monthly-storage", "refund-commission"] }).families,
    ["monthly-storage", "refund-commission"],
  );
});
