import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinancialReviewCoverage,
  describeTypeFamilyCoverage,
} from "../src/financial-review-coverage.ts";

const row = (finances, dataKiosk) => ({
  finances_row_count: finances,
  data_kiosk_row_count: dataKiosk,
});
const paired = { financesTypes: ["REMOVAL_FEES"], dataKioskTypes: ["REMOVAL_FEE"] };
const familyRow = (month, source, rowCount = 1n) => ({ month, source, rowCount });

test("monthly coverage partitions both, single-source and genuinely empty months", () => {
  assert.deepEqual(
    buildFinancialReviewCoverage([row("2", "3"), row("5", "0"), row("0", "7"), row("0", "0")]),
    {
      financesRowCount: "7",
      dataKioskRowCount: "10",
      monthCount: 4,
      months: { onlyFinances: 1, onlyDataKiosk: 1, both: 1, noRecords: 1, unknownCounts: 0 },
    },
  );
});

test("source counts retain precision beyond Number's safe integer range", () => {
  const result = buildFinancialReviewCoverage([
    row("9007199254740993", "18446744073709551616"),
    row("7", "9"),
  ]);
  assert.equal(result.financesRowCount, "9007199254741000");
  assert.equal(result.dataKioskRowCount, "18446744073709551625");
  assert.equal(result.months.both, 2);
});

test("missing or malformed counts never become zero or poison the known source total", () => {
  for (const invalid of [undefined, null, "", "-1", "1.5", "1e2", "NaN", " 0", "01", 0]) {
    const financesUnknown = buildFinancialReviewCoverage([row(invalid, "0"), row("3", "4")]);
    assert.equal(financesUnknown.financesRowCount, null);
    assert.equal(financesUnknown.dataKioskRowCount, "4");
    assert.deepEqual(financesUnknown.months, {
      onlyFinances: 0,
      onlyDataKiosk: 0,
      both: 1,
      noRecords: 0,
      unknownCounts: 1,
    });
    const kioskUnknown = buildFinancialReviewCoverage([row("3", "4"), row("2", invalid)]);
    assert.equal(kioskUnknown.financesRowCount, "5");
    assert.equal(kioskUnknown.dataKioskRowCount, null);
    assert.equal(kioskUnknown.months.unknownCounts, 1);
    assert.equal(kioskUnknown.months.onlyFinances, 0);
  }
  assert.equal(buildFinancialReviewCoverage([{}]).months.unknownCounts, 1);
});

test("zero and cancelling money do not erase source records", () => {
  const result = buildFinancialReviewCoverage([
    { ...row("0", "93"), finances_amount: "0", data_kiosk_amount: "0", difference: "0" },
    { ...row("3", "0"), finances_amount: "0", data_kiosk_amount: "0", difference: "0" },
  ]);
  assert.equal(result.financesRowCount, "3");
  assert.equal(result.dataKioskRowCount, "93");
  assert.deepEqual(result.months, {
    onlyFinances: 1,
    onlyDataKiosk: 1,
    both: 0,
    noRecords: 0,
    unknownCounts: 0,
  });
});

test("empty input has no observed months and coverage does not mutate monthly totals", () => {
  assert.deepEqual(buildFinancialReviewCoverage([]), {
    financesRowCount: "0",
    dataKioskRowCount: "0",
    monthCount: 0,
    months: { onlyFinances: 0, onlyDataKiosk: 0, both: 0, noRecords: 0, unknownCounts: 0 },
  });
  const rows = Object.freeze([Object.freeze(row("2", "3"))]);
  assert.equal(buildFinancialReviewCoverage(rows).months.both, 1);
  assert.deepEqual(rows, [row("2", "3")]);
});

test("intentionally unpaired family definitions are distinct from missing paired records", () => {
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-07-01", "DATA_KIOSK", 93n)], {
      financesTypes: [],
      dataKioskTypes: ["NET_PRODUCT_SALES"],
    }),
    "Data Kiosk mapping only",
  );
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-07-01", "FINANCES")], {
      financesTypes: ["TAX_WITHHELD"],
      dataKioskTypes: [],
    }),
    "Finances mapping only",
  );
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-04-01", "DATA_KIOSK")], paired),
    "No Finances rows in this scope",
  );
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-05-01", "FINANCES", 3n)], paired),
    "No Data Kiosk rows in this scope",
  );
});

test("yearly paired coverage reports overlapping months rather than mere presence somewhere", () => {
  assert.equal(
    describeTypeFamilyCoverage(
      [familyRow("2026-04-01", "DATA_KIOSK"), familyRow("2026-05-01", "FINANCES", 3n)],
      paired,
    ),
    "Both sources in 0 of 2 months",
  );
  assert.equal(
    describeTypeFamilyCoverage(
      [
        familyRow("2026-01-01", "FINANCES"),
        familyRow("2026-01-01", "FINANCES", 2n),
        familyRow("2026-01-01", "DATA_KIOSK"),
        familyRow("2026-02-01", "DATA_KIOSK"),
        familyRow("2026-03-01", "FINANCES"),
        familyRow("2026-03-01", "DATA_KIOSK"),
      ],
      paired,
    ),
    "Both sources in 2 of 3 months",
  );
  assert.equal(
    describeTypeFamilyCoverage(
      [familyRow("2026-01-01", "FINANCES"), familyRow("2026-01-01", "DATA_KIOSK")],
      paired,
    ),
    "Both sources",
  );
});

test("family coverage excludes zero-count groups and never labels unknown counts as absent", () => {
  assert.equal(describeTypeFamilyCoverage([], paired), "No source rows in this scope");
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-01-01", "FINANCES", 0n)], paired),
    "No source rows in this scope",
  );
  for (const invalid of [undefined, null, "1", -1n])
    assert.equal(
      describeTypeFamilyCoverage(
        [{ month: "2026-01-01", source: "FINANCES", rowCount: invalid }],
        paired,
      ),
      "Source availability unknown",
    );
  assert.equal(
    describeTypeFamilyCoverage([familyRow("", "FINANCES")], paired),
    "Source availability unknown",
  );
  assert.equal(
    describeTypeFamilyCoverage([familyRow("2026-01-01", "OTHER")], paired),
    "Source availability unknown",
  );
  assert.equal(
    describeTypeFamilyCoverage([], { financesTypes: [], dataKioskTypes: [] }),
    "Source availability unknown",
  );
});
