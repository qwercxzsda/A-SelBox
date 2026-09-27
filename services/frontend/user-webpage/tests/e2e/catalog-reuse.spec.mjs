import { expect, test } from "@playwright/test";
import { skuAssignments } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn, sortBy } from "./table-actions.mjs";

async function setup(page, { role = "operator", expiresIn = 90 } = {}) {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.skuOptions = ["ALPHA-001", "ADMIN-ONLY"];
  fixture.assignments = skuAssignments(["ALPHA-001"]);
  fixture.authSessionForRequest = ({ grantType, user }) => ({
    access_token: grantType === "password" ? "initial-access" : "renewed-access",
    refresh_token: grantType === "password" ? "initial-refresh" : "renewed-refresh",
    token_type: "bearer",
    expires_in: grantType === "password" ? expiresIn : 3600,
    user: { id: user, email: `${user}@example.test` },
  });
  await signIn(page);
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  return fixture;
}

async function expectRenewedLookups(fixture) {
  await expect
    .poll(
      () =>
        fixture.identityRequests.filter(({ accessToken }) => accessToken === "renewed-access")
          .length,
    )
    .toBe(2);
  expect(fixture.authCalls.filter(({ grantType }) => grantType === "refresh_token")).toHaveLength(
    1,
  );
}

async function expectSku(page, sku, visible = true) {
  const menu = await openColumn(page, "SKU");
  await expect(menu.getByRole("checkbox", { name: sku, exact: true })).toHaveCount(visible ? 1 : 0);
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

test("unchanged administrator renewal reuses catalog but renews credentials and reloads lookups without resetting the view", async ({
  page,
}) => {
  const fixture = await setup(page);
  const source = await openColumn(page, "Source");
  await source.getByRole("checkbox", { name: "Settlements", exact: true }).check();
  await source.getByRole("button", { name: "Close options", exact: true }).click();
  await sortBy(page, "Date", "Oldest first");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  const rows = fixture.requests.length;
  const counts = fixture.countRequests.length;
  fixture.companyNames["company-member-a"] = "Fresh company label";
  await page.clock.fastForward(30_000);
  await expectRenewedLookups(fixture);
  await expect(
    page.getByRole("cell", { name: "Fresh company label", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  expect(fixture.optionRequests).toHaveLength(1);
  expect(fixture.requests).toHaveLength(rows);
  expect(fixture.countRequests).toHaveLength(counts);
  const restored = await openColumn(page, "Source");
  await expect(restored.getByRole("checkbox", { name: "Settlements", exact: true })).toBeChecked();
});

test("a changed revision forces one catalog download during token renewal", async ({ page }) => {
  const fixture = await setup(page);
  fixture.revisions.data_kiosk = "1";
  fixture.skuOptions.push("NEW-SKU");
  fixture.companyNames["company-member-a"] = "Fresh company label";
  await page.clock.fastForward(30_000);
  await expectRenewedLookups(fixture);
  await expect(
    page.getByRole("cell", { name: "Fresh company label", exact: true }).first(),
  ).toBeVisible();
  await expectSku(page, "NEW-SKU");
  expect(fixture.optionRequests).toHaveLength(2);
});

test("renewal uses the latest identity catalog after an earlier revision refresh", async ({
  page,
}) => {
  const fixture = await setup(page, { expiresIn: 180 });
  fixture.revisions.settlement = "1";
  fixture.skuOptions.push("FROM-REVISION");
  fixture.companyNames["company-member-a"] = "Revision company label";
  await page.clock.fastForward(60_000);
  await expect(
    page.getByRole("cell", { name: "Revision company label", exact: true }).first(),
  ).toBeVisible();
  await expectSku(page, "FROM-REVISION");
  expect(fixture.optionRequests).toHaveLength(2);
  fixture.companyNames["company-member-a"] = "Renewed company label";
  await page.clock.fastForward(60_000);
  await expectRenewedLookups(fixture);
  await expect(
    page.getByRole("cell", { name: "Renewed company label", exact: true }).first(),
  ).toBeVisible();
  await expectSku(page, "FROM-REVISION");
  expect(fixture.optionRequests).toHaveLength(2);
});

test("administrator demotion during renewal removes administrator catalogs and resets its workspace", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("tab", { name: "Settlements", exact: true }).click();
  fixture.roles["member-a"] = "company_member";
  fixture.assignments = skuAssignments(["MEMBER-ONLY"]);
  await page.clock.fastForward(30_000);
  await expectRenewedLookups(fixture);
  await expect(page.getByRole("tab", { name: "Settlements", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectSku(page, "MEMBER-ONLY");
  await expectSku(page, "ADMIN-ONLY", false);
  expect(fixture.optionRequests).toHaveLength(1);
});

test("member renewal rebuilds SKU options from fresh assignments even with unchanged revisions", async ({
  page,
}) => {
  const fixture = await setup(page, { role: "company_member" });
  fixture.assignments = skuAssignments(["MEMBER-NEW"]);
  fixture.companyNames["company-member-a"] = "Fresh member label";
  await page.clock.fastForward(30_000);
  await expectRenewedLookups(fixture);
  await expect(page.getByText("Fresh member label", { exact: true })).toBeVisible();
  await expectSku(page, "MEMBER-NEW");
  await expectSku(page, "ALPHA-001", false);
  expect(fixture.optionRequests).toHaveLength(0);
});

test("forced workspace retry downloads the administrator catalog despite identical revision tokens", async ({
  page,
}) => {
  const fixture = await setup(page, { expiresIn: 3600 });
  fixture.revisionStatus = 503;
  await page.clock.fastForward(60_000);
  const retry = page.getByRole("button", { name: "Retry update", exact: true });
  await expect(retry).toBeVisible();
  fixture.revisionStatus = 200;
  fixture.skuOptions.push("FORCED-NEW");
  await retry.click();
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  await expectSku(page, "FORCED-NEW");
  expect(fixture.optionRequests).toHaveLength(2);
});

test("a late identity refresh cannot replace a newer renewed catalog", async ({ page }) => {
  const fixture = await setup(page, { expiresIn: 180 });
  const started = deferred();
  const release = deferred();
  fixture.beforeCompanies = async ({ accessToken }) => {
    if (accessToken === "initial-access") {
      started.resolve();
      await release.promise;
    }
  };
  fixture.revisions.settlement = "1";
  fixture.skuOptions = ["ALPHA-001", "STALE-CATALOG"];
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    await expect.poll(() => fixture.optionRequests.length).toBe(2);
    fixture.revisions.settlement = "2";
    fixture.skuOptions = ["ALPHA-001", "NEWEST-CATALOG"];
    fixture.companyNames["company-member-a"] = "Renewed company label";
    await page.clock.fastForward(60_000);
    await expectRenewedLookups(fixture);
    await expect(
      page.getByRole("cell", { name: "Renewed company label", exact: true }).first(),
    ).toBeVisible();
    await expectSku(page, "NEWEST-CATALOG");
    release.resolve();
    await page.clock.runFor(100);
    await expectSku(page, "NEWEST-CATALOG");
    await expectSku(page, "STALE-CATALOG", false);
    expect(fixture.optionRequests).toHaveLength(3);
  } finally {
    release.resolve();
  }
});

test("reload and signing out discard the in-memory catalog reuse candidate", async ({ page }) => {
  const fixture = await setup(page, { expiresIn: 3600 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect.poll(() => fixture.optionRequests.length).toBe(2);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await expect.poll(() => fixture.optionRequests.length).toBe(3);
});
