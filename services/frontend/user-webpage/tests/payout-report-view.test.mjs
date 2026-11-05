import assert from "node:assert/strict";
import test from "node:test";
import {
  createPayoutHistoryState,
  decodePayoutHistoryState,
  payoutScopeKey,
  payoutVersionSelection,
} from "../src/payout-report-view.ts";
import { payoutMarketplaceLabel, payoutMarketplace } from "../src/payout-report-scope.ts";
import { COMPANY_ID, OTHER_COMPANY_ID } from "./api-fixtures.mjs";

const selection = {
  companyId: COMPANY_ID,
  reportId: OTHER_COMPANY_ID,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  currency: "USD",
  marketplaceName: "Amazon.com",
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

test("payout marketplace scope keeps same-currency countries and unspecified reports distinct", () => {
  const row = {
    id: OTHER_COMPANY_ID,
    company_id: COMPANY_ID,
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    currency: "EUR",
  };
  const reports = ["Amazon.de", "Amazon.fr", null].map((marketplace_name) => ({
    ...row,
    marketplace_name,
  }));
  assert.equal(new Set(reports.map(payoutScopeKey)).size, 3);
  assert.deepEqual(reports.map(payoutMarketplaceLabel), [
    "Amazon.de",
    "Amazon.fr",
    "Not specified",
  ]);
  for (const report of reports) {
    const selected = payoutVersionSelection(report);
    assert.deepEqual(decodePayoutHistoryState({ selected }).selected, selected);
  }
  for (const marketplaceName of [undefined, "", "Amazon\0de", "Unknown market"])
    assert.equal(
      decodePayoutHistoryState({ selected: { ...selection, marketplaceName } }).selected,
      null,
    );
});

test("published reports require an explicit valid marketplace, including genuine null", () => {
  for (const row of [{}, { marketplace_name: "" }, { marketplace_name: "Unknown market" }]) {
    assert.throws(
      () => payoutMarketplace(row),
      /Payout report returned a missing or invalid marketplace/,
    );
    assert.throws(() => payoutMarketplaceLabel(row), /missing or invalid marketplace/);
  }
  assert.equal(payoutMarketplace({ marketplace_name: null }), null);
  assert.equal(payoutMarketplace({ marketplace_name: "Amazon.de" }), "Amazon.de");
});
