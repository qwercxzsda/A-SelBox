import assert from "node:assert/strict";
import test from "node:test";
import { reusableAdminSkuOptions } from "../src/identity-catalog.ts";

const session = { user: { id: "admin-a" }, access_token: "new-access" };
const account = { user_id: "admin-a", access_role: "operator", company_id: null };
const revisions = { settlement: "1", data_kiosk: "2", fees: "3" };
const previous = {
  session: { ...session, access_token: "old-access" },
  account,
  revisions,
  companies: [],
  assignments: [],
  skuOptions: ["SKU-A"],
};
const snapshot = { account, revisions };

test("renewed credentials may reuse only the same verified administrator catalog", () => {
  assert.equal(reusableAdminSkuOptions(previous, session, snapshot), previous.skuOptions);
  const empty = { ...previous, skuOptions: [] };
  assert.equal(reusableAdminSkuOptions(empty, session, snapshot), empty.skuOptions);
  assert.equal(reusableAdminSkuOptions(previous, session, snapshot, true), null);
  assert.equal(reusableAdminSkuOptions(null, session, snapshot), null);
  assert.equal(reusableAdminSkuOptions(undefined, session, snapshot), null);
});

test("every defined revision must match before reuse, including fee-only changes", () => {
  for (const source of ["settlement", "data_kiosk", "fees"]) {
    for (const value of [undefined, "changed", "", " ", null]) {
      assert.equal(
        reusableAdminSkuOptions(previous, session, {
          account,
          revisions: { ...revisions, [source]: value },
        }),
        null,
      );
      assert.equal(
        reusableAdminSkuOptions(
          { ...previous, revisions: { ...revisions, [source]: value } },
          session,
          snapshot,
        ),
        null,
      );
    }
  }
  assert.equal(
    reusableAdminSkuOptions({ ...previous, revisions: {} }, session, { account, revisions: {} }),
    null,
  );
});

test("user, role, or company changes reject the prior catalog even with identical tokens", () => {
  assert.equal(
    reusableAdminSkuOptions(previous, { ...session, user: { id: "admin-b" } }, snapshot),
    null,
  );
  for (const changed of [
    { ...account, user_id: "admin-b" },
    { ...account, access_role: "company_member", company_id: "company-a" },
    { ...account, company_id: "company-b" },
  ])
    assert.equal(reusableAdminSkuOptions(previous, session, { account: changed, revisions }), null);
  const member = { ...account, access_role: "company_member", company_id: "company-a" };
  assert.equal(
    reusableAdminSkuOptions({ ...previous, account: member }, session, {
      account: member,
      revisions,
    }),
    null,
  );
  assert.equal(reusableAdminSkuOptions({ ...previous, account: member }, session, snapshot), null);
});
