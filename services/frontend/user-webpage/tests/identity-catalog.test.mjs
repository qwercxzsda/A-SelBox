import assert from "node:assert/strict";
import test from "node:test";
import { reusableAdministratorSkuOptions } from "../src/identity-catalog.ts";

const session = { user: { id: "administrator-a" }, access_token: "new-access" };
const account = { user_id: "administrator-a", access_role: "administrator", company_id: null };
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
  assert.equal(reusableAdministratorSkuOptions(previous, session, snapshot), previous.skuOptions);
  const empty = { ...previous, skuOptions: [] };
  assert.equal(reusableAdministratorSkuOptions(empty, session, snapshot), empty.skuOptions);
  assert.equal(reusableAdministratorSkuOptions(previous, session, snapshot, true), null);
  assert.equal(reusableAdministratorSkuOptions(null, session, snapshot), null);
  assert.equal(reusableAdministratorSkuOptions(undefined, session, snapshot), null);
});

test("every defined revision must match before reuse, including fee-only changes", () => {
  for (const source of ["settlement", "data_kiosk", "fees"]) {
    for (const value of [undefined, "changed", "", " ", null]) {
      assert.equal(
        reusableAdministratorSkuOptions(previous, session, {
          account,
          revisions: { ...revisions, [source]: value },
        }),
        null,
      );
      assert.equal(
        reusableAdministratorSkuOptions(
          { ...previous, revisions: { ...revisions, [source]: value } },
          session,
          snapshot,
        ),
        null,
      );
    }
  }
  assert.equal(
    reusableAdministratorSkuOptions({ ...previous, revisions: {} }, session, {
      account,
      revisions: {},
    }),
    null,
  );
});

test("inventory publications do not invalidate an unchanged financial SKU catalog", () => {
  assert.equal(
    reusableAdministratorSkuOptions(
      { ...previous, revisions: { ...revisions, inventory: "old" } },
      session,
      { account, revisions: { ...revisions, inventory: "new" } },
    ),
    previous.skuOptions,
  );
});

test("user, role, or company changes reject the prior catalog even with identical tokens", () => {
  assert.equal(
    reusableAdministratorSkuOptions(
      previous,
      { ...session, user: { id: "administrator-b" } },
      snapshot,
    ),
    null,
  );
  for (const changed of [
    { ...account, user_id: "administrator-b" },
    { ...account, access_role: "member", company_id: "company-a" },
    { ...account, company_id: "company-b" },
  ])
    assert.equal(
      reusableAdministratorSkuOptions(previous, session, { account: changed, revisions }),
      null,
    );
  const member = { ...account, access_role: "member", company_id: "company-a" };
  assert.equal(
    reusableAdministratorSkuOptions({ ...previous, account: member }, session, {
      account: member,
      revisions,
    }),
    null,
  );
  assert.equal(
    reusableAdministratorSkuOptions({ ...previous, account: member }, session, snapshot),
    null,
  );
});
