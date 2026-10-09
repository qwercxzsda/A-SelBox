import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

const targetUser = "00000000-0000-4000-8000-000000000001";
const companyA = "00000000-0000-4000-8000-00000000000a";
const companyB = "00000000-0000-4000-8000-00000000000b";
const targetEmail = "new-member@example.test";

const accountRow = (page, email) =>
  page.getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
const membershipDrawer = (page) =>
  page.getByRole("dialog", { name: "Company membership", exact: true });

async function setupAdministrator(page, role = "unassigned") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.roles[targetUser] = role;
  fixture.accountEmails[targetUser] = targetEmail;
  fixture.companyIds[targetUser] = role === "member" ? companyA : null;
  fixture.companyNames[companyA] = "North Company";
  fixture.companyNames[companyB] = "South Company";
  await signIn(page);
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await expect(accountRow(page, targetEmail)).toBeVisible();
  return fixture;
}

async function chooseCompany(page, name) {
  const input = membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true });
  await input.fill(name);
  await page.getByRole("option", { name, exact: true }).click();
}

async function saveMembership(page, company) {
  await membershipDrawer(page)
    .getByRole("button", { name: "Save membership", exact: true })
    .click();
  await expect(accountRow(page, targetEmail)).toContainText(company);
  await membershipDrawer(page)
    .getByRole("button", { name: "Close membership details", exact: true })
    .click();
  await expect(membershipDrawer(page)).toBeHidden();
}

test("administrator assigns an unassigned user and can find the persisted membership after reload", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page);
  await expect(accountRow(page, targetEmail)).toContainText("Unassigned");
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("new-member");
  await expect(accountRow(page, "member-b@example.test")).toHaveCount(0);
  await accountRow(page, targetEmail).click();
  await expect(
    membershipDrawer(page).getByRole("button", { name: "Save membership", exact: true }),
  ).toBeDisabled();
  await expect(
    membershipDrawer(page).getByRole("button", { name: "Revoke membership", exact: true }),
  ).toHaveCount(0);
  await chooseCompany(page, "North Company");
  await saveMembership(page, "North Company");
  await expect(accountRow(page, targetEmail)).toContainText("Member");
  await expect(accountRow(page, targetEmail)).toContainText("North Company");
  expect(fixture.membershipRequests).toHaveLength(1);
  expect(fixture.membershipRequests[0].body).toMatchObject({
    target_user_id: targetUser,
    target_company_id: companyA,
    expected_access_role: "unassigned",
    expected_company_id: null,
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(search).toHaveValue("new-member");
  await expect(accountRow(page, targetEmail)).toContainText("North Company");
  expect(fixture.membershipRequests).toHaveLength(1);
  await accountRow(page, targetEmail).click();
  await membershipDrawer(page)
    .getByRole("button", { name: "Revoke membership", exact: true })
    .click();
  await membershipDrawer(page)
    .getByRole("button", { name: "Confirm revocation", exact: true })
    .click();
  await expect(accountRow(page, targetEmail)).toContainText("Unassigned");
  await expect(
    membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("");
  await expect(
    membershipDrawer(page).getByRole("button", { name: "Save membership", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("");
  expect(fixture.membershipRequests).toHaveLength(2);
});

test("administrator transfers a member then explicitly confirms membership revocation", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page, "member");
  await accountRow(page, targetEmail).click();
  await chooseCompany(page, "South Company");
  await saveMembership(page, "South Company");
  await expect(accountRow(page, targetEmail)).toContainText("South Company");
  expect(fixture.membershipRequests[0].body.target_company_id).toBe(companyB);
  await accountRow(page, targetEmail).click();
  await membershipDrawer(page)
    .getByRole("button", { name: "Revoke membership", exact: true })
    .click();
  await expect(membershipDrawer(page)).toContainText("Revoke company membership?");
  expect(fixture.membershipRequests).toHaveLength(1);
  await membershipDrawer(page)
    .getByRole("button", { name: "Keep membership", exact: true })
    .click();
  await expect(
    membershipDrawer(page).getByText("Revoke company membership?", { exact: true }),
  ).toHaveCount(0);
  await membershipDrawer(page)
    .getByRole("button", { name: "Revoke membership", exact: true })
    .click();
  await membershipDrawer(page)
    .getByRole("button", { name: "Confirm revocation", exact: true })
    .click();
  await expect(accountRow(page, targetEmail)).toContainText("Unassigned");
  await membershipDrawer(page)
    .getByRole("button", { name: "Close membership details", exact: true })
    .click();
  await expect(membershipDrawer(page)).toBeHidden();
  await expect(accountRow(page, targetEmail)).not.toContainText("South Company");
  expect(fixture.membershipRequests).toHaveLength(2);
  expect(fixture.membershipRequests[1].body).toMatchObject({
    target_user_id: targetUser,
    target_company_id: null,
  });
});

test("administrator accounts are read-only and no role-promotion controls are exposed", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page);
  const administrator = accountRow(page, "member-a@example.test");
  await administrator.focus();
  await page.keyboard.press("Enter");
  await expect(membershipDrawer(page)).toContainText(
    "Administrator access can only be changed by the database manager.",
  );
  await expect(
    membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveCount(0);
  await expect(
    membershipDrawer(page).getByRole("button", { name: /^(Save|Revoke) membership$/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await accountRow(page, targetEmail).click();
  await expect(membershipDrawer(page).getByRole("combobox", { name: /role/i })).toHaveCount(0);
  await expect(
    membershipDrawer(page).getByRole("button", { name: /administrator|admin/i }),
  ).toHaveCount(0);
  expect(fixture.membershipRequests).toHaveLength(0);
});

test("a rejected membership change preserves the saved access and can be retried", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page);
  fixture.membershipStatus = 503;
  await accountRow(page, targetEmail).click();
  await chooseCompany(page, "North Company");
  await membershipDrawer(page)
    .getByRole("button", { name: "Save membership", exact: true })
    .click();
  await expect(membershipDrawer(page).getByRole("alert")).toContainText(
    "Could not save membership",
  );
  expect(fixture.roles[targetUser]).toBe("unassigned");
  await expect(accountRow(page, targetEmail)).toContainText("Unassigned");
  fixture.membershipStatus = 200;
  await saveMembership(page, "North Company");
  await expect(accountRow(page, targetEmail)).toContainText("North Company");
});

test("an unfinished membership selection survives reload without granting access", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page);
  await accountRow(page, targetEmail).click();
  await chooseCompany(page, "North Company");
  await page.reload();
  await expect(membershipDrawer(page)).toBeVisible();
  await expect(
    membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("North Company");
  await expect(accountRow(page, targetEmail)).toContainText("Unassigned");
  expect(fixture.membershipRequests).toHaveLength(0);
  await saveMembership(page, "North Company");
  expect(fixture.membershipRequests).toHaveLength(1);
});

test("a concurrent membership update is preserved instead of overwritten by a stale form", async ({
  page,
}) => {
  const fixture = await setupAdministrator(page);
  await accountRow(page, targetEmail).click();
  await chooseCompany(page, "North Company");
  fixture.roles[targetUser] = "member";
  fixture.companyIds[targetUser] = companyB;
  await membershipDrawer(page)
    .getByRole("button", { name: "Save membership", exact: true })
    .click();
  await expect(accountRow(page, targetEmail)).toContainText("South Company");
  await expect(
    membershipDrawer(page).getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("South Company");
  expect(fixture.membershipRequests).toHaveLength(1);
  expect(fixture.companyIds[targetUser]).toBe(companyB);
  await chooseCompany(page, "North Company");
  await saveMembership(page, "North Company");
  expect(fixture.membershipRequests[1].body).toMatchObject({
    expected_access_role: "member",
    expected_company_id: companyB,
  });
});

for (const width of [1440, 390]) {
  test(`membership editing keeps its controls usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setupAdministrator(page, "member");
    fixture.accountConfirmed[targetUser] = false;
    await page.reload();
    await accountRow(page, targetEmail).click();
    const drawer = membershipDrawer(page);
    await expect(drawer).toContainText("This user has not confirmed their email yet");
    await drawer.getByRole("button", { name: "Revoke membership", exact: true }).click();
    const confirm = drawer.getByRole("button", { name: "Confirm revocation", exact: true });
    await expect(confirm).toBeInViewport();
    await expect(
      drawer.getByRole("button", { name: "Keep membership", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`membership-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(accountRow(page, targetEmail)).toBeFocused();
    expect(fixture.membershipRequests).toHaveLength(0);
  });
}

const financialReads = (fixture) => ({
  rows: fixture.requests.length,
  counts: fixture.countRequests.length,
  options: fixture.optionRequests.length,
  latest: fixture.latestRequests.length,
  totals: fixture.aggregateRequests.length,
  details: fixture.breakdownRequests.length,
  fees: fixture.configurationRequests.length,
});

async function checkUnchangedAccess(page, fixture) {
  const requests = fixture.revisionRequests.length;
  await page.clock.fastForward(60_000);
  await expect.poll(() => fixture.revisionRequests.length).toBeGreaterThan(requests);
  // Finish this request before another clock jump; a pending request has its own deadline.
  await expect.poll(() => fixture.revisionRequests.at(-1).completed).toBe(true);
}

test("unassigned users load no company data, retain their session on reload, and receive membership automatically", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "unassigned";
  fixture.companyIds["member-a"] = null;
  await signIn(page);
  await expect(page.getByText("Awaiting company access", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(Object.values(financialReads(fixture)).every((count) => count === 0)).toBe(true);
  expect(fixture.identityRequests).toHaveLength(0);
  await page.reload();
  await expect(page.getByText("Awaiting company access", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect(fixture.authRequests).toBe(1);
  const reads = financialReads(fixture);
  await checkUnchangedAccess(page, fixture);
  expect(financialReads(fixture)).toEqual(reads);
  fixture.roles["member-a"] = "member";
  fixture.companyIds["member-a"] = "company-member-a";
  await page.clock.fastForward(60_000);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByText("Awaiting company access", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
  expect(fixture.authRequests).toBe(1);
});

test("revoking membership removes the visible financial workspace and reassignment uses fresh company data", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  fixture.roles["member-a"] = "unassigned";
  fixture.companyIds["member-a"] = null;
  await page.clock.fastForward(60_000);
  await expect(page.getByText("Awaiting company access", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Financial records", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Estimated totals", exact: true })).toHaveCount(0);
  const reads = financialReads(fixture);
  await checkUnchangedAccess(page, fixture);
  expect(financialReads(fixture)).toEqual(reads);
  fixture.roles["member-a"] = "member";
  fixture.companyIds["member-a"] = "company-member-b";
  fixture.prefixes["member-a"] = "REASSIGNED";
  await page.clock.fastForward(60_000);
  await expect(rowWithSku(page, "REASSIGNED-001")).toBeVisible();
  await expect(rowWithSku(page, "ALPHA-001")).toHaveCount(0);
  expect(fixture.authRequests).toBe(1);
  expect(fixture.requests.length).toBeGreaterThan(reads.rows);
});
