import assert from "node:assert/strict";
import test from "node:test";
import { createPayoutHistoryState, decodePayoutHistoryState } from "../src/payout-report-view.ts";
import { COMPANY_ID, OTHER_COMPANY_ID } from "./api-fixtures.mjs";

const selection = {
  companyId: COMPANY_ID,
  reportId: OTHER_COMPANY_ID,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  currency: "USD",
};

test("payout history restores only navigation and scope, never saved financial values", () => {
  const history = { expanded: ["scope"], pages: { scope: 2 }, selected: selection };
  assert.deepEqual(
    decodePayoutHistoryState({
      ...history,
      selected: { ...selection, company_amount: "9007199254740993.01", source_amount: "100" },
      rows: [{ company_amount: "123" }],
    }),
    history,
  );
  assert.deepEqual(decodePayoutHistoryState(null), createPayoutHistoryState());
  assert.deepEqual(decodePayoutHistoryState([]), createPayoutHistoryState());
});

test("malformed saved version scopes cannot trigger a report request after reload", () => {
  for (const patch of [
    { companyId: "all" },
    { reportId: "invalid" },
    { startDate: "" },
    { startDate: "2026-02-30" },
    { endDate: "2026-06-30" },
    { currency: "usd" },
    { currency: "USD,EUR" },
  ]) {
    assert.equal(decodePayoutHistoryState({ selected: { ...selection, ...patch } }).selected, null);
  }
  assert.deepEqual(
    decodePayoutHistoryState({ selected: { ...selection, currency: null } }).selected,
    {
      ...selection,
      currency: null,
    },
  );
});

test("payout history rejects malformed navigation and bounds saved page indexes", () => {
  assert.deepEqual(decodePayoutHistoryState({ expanded: ["scope", "scope"], pages: [] }), {
    expanded: ["scope"],
    pages: {},
    selected: null,
  });
  for (const page of [-1, 1.5, "1", Number.MAX_SAFE_INTEGER, null]) {
    assert.equal(decodePayoutHistoryState({ pages: { scope: page } }).pages.scope, 0);
  }
});
