import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import {
  closeCompanyCreation,
  companyCreation,
  companyPanel,
  companyRow,
} from "./company-actions.mjs";
import {
  COMPANY,
  OTHER_COMPANY,
  editor,
  item,
  openEditor,
  setup,
} from "./sku-configuration-fixtures.mjs";

const UNUSED = "0198b50b-701a-7000-8000-000000000800";
const EXTRA = "0198b50b-701a-7000-8000-000000000801";
const button = (parent, name) => parent.getByRole("button", { name, exact: true });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const row = (page, name = "Unused Company") => companyRow(page, name);
const company = (page, name = "Unused Company") => companyPanel(page, name);
const confirmation = (page, name = "Unused Company") =>
  page.getByRole("region", { name: `Delete ${name}`, exact: true });

async function start(page, configure = () => {}) {
  const fixture = await setup(page, "administrator", [item("S1")], (fixture) => {
    fixture.companyNames[UNUSED] = "Unused Company";
    configure(fixture);
  });
  await tab(page, "Companies").click();
  return fixture;
}

async function askToDelete(page, name = "Unused Company") {
  if (!(await company(page, name).isVisible())) await row(page, name).click();
  await expect(company(page, name)).toBeVisible();
  await button(company(page, name), "Delete company").click();
  await expect(confirmation(page, name)).toBeVisible();
}

async function deleteConfirmed(page, name = "Unused Company") {
  await askToDelete(page, name);
  await button(confirmation(page, name), "Delete permanently").click();
  await expect(row(page, name)).toHaveCount(0);
}

test("administrator explicitly deletes an unused company and all company pickers update", async ({
  page,
}) => {
  const fixture = await start(page);
  await askToDelete(page);
  expect(fixture.companyDeletionRequests).toHaveLength(0);
  await button(confirmation(page), "Cancel").click();
  await expect(confirmation(page)).toHaveCount(0);
  await deleteConfirmed(page);
  await expect(row(page, "Alpha Company")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Company deleted: Unused Company" }),
  ).toBeVisible();
  expect(fixture.companyDeletionRequests).toHaveLength(1);
  expect(fixture.companyDeletionRequests[0].body).toEqual({ target_company_id: UNUSED });
  await tab(page, "Current fees").click();
  await openEditor(page);
  await expect(
    editor(page).getByRole("option", { name: "Unused Company", exact: true }),
  ).toHaveCount(0);
  await expect(editor(page).getByRole("combobox", { name: "Company", exact: true })).toHaveValue(
    COMPANY,
  );
  await button(editor(page), "Close SKU editor").click();
  await tab(page, "User access").click();
  await page.getByRole("row").filter({ hasText: "member-b@example.test" }).click();
  const membership = page.getByRole("dialog", { name: "Company membership", exact: true });
  await membership.getByRole("combobox", { name: "Company", exact: true }).fill("Unused Company");
  await expect(page.getByRole("option", { name: "Unused Company", exact: true })).toHaveCount(0);
  expect(fixture.membershipRequests).toHaveLength(0);
  expect(fixture.configurationSaves).toHaveLength(0);
  expect(fixture.companyIds["member-b"]).toBe(OTHER_COMPANY);
});

test("historical fee versions and every linked-record reason block deletion even with no current SKUs", async ({
  page,
}, testInfo) => {
  const fixture = await start(page, (fixture) => {
    fixture.companyDeletionBlockers[UNUSED] = [
      { code: "payout_reports", count: 5 },
      { code: "payout_refreshes", count: 1 },
      { code: "terms_versions", count: 7 },
      { code: "assigned_skus", count: 3 },
      { code: "members", count: 2 },
    ];
  });
  await askToDelete(page);
  await expect(companyRow(page, "Unused Company").locator(".numeric")).toHaveText("0");
  await button(confirmation(page), "Delete permanently").click();
  const error = confirmation(page).getByRole("alert");
  await expect(error).toContainText("Company cannot be deleted");
  for (const label of [
    "Members",
    "Assigned SKUs",
    "Fee versions",
    "Payout reports",
    "Payout refreshes",
  ])
    await expect(error).toContainText(label);
  await expect(error).toContainText("7");
  await expect(error.locator("li")).toHaveText([
    "Members: 2",
    "Assigned SKUs: 3",
    "Fee versions (including history): 7",
    "Payout reports: 5",
    "Payout refreshes: 1",
  ]);
  await expect(row(page)).toBeVisible();
  expect(fixture.companyNames[UNUSED]).toBe("Unused Company");
  expect(fixture.membershipRequests).toHaveLength(0);
  expect(fixture.configurationSaves).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("company-deletion-blocked.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("a just-created company can be deleted without waiting for a catalog refresh", async ({
  page,
}) => {
  const fixture = await start(page);
  await button(page, "Add company").click();
  await page.getByLabel("Company name", { exact: true }).fill("Temporary Company");
  await button(page, "Create company").click();
  await expect(companyCreation(page).getByRole("status")).toContainText(
    "Company added: Temporary Company",
  );
  await closeCompanyCreation(page);
  await expect(row(page, "Temporary Company")).toBeVisible();
  const id = fixture.companyCreationRequests[0].result.id;
  await deleteConfirmed(page, "Temporary Company");
  expect(fixture.companyNames[id]).toBeUndefined();
  await tab(page, "Current fees").click();
  await tab(page, "Companies").click();
  await expect(row(page, "Temporary Company")).toHaveCount(0);
});

test("confirmation is not submitted on reload and a pending deletion cannot be repeated", async ({
  page,
}) => {
  const fixture = await start(page);
  await askToDelete(page);
  await page.reload();
  await expect(row(page)).toBeVisible();
  await expect(confirmation(page)).toHaveCount(0);
  expect(fixture.companyDeletionRequests).toHaveLength(0);
  const started = deferred(),
    release = deferred();
  fixture.beforeCompanyDeletion = async () => {
    started.resolve();
    await release.promise;
  };
  await askToDelete(page);
  try {
    await button(confirmation(page), "Delete permanently").click();
    await started.promise;
    await expect(button(confirmation(page), "Delete permanently")).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(fixture.companyDeletionRequests).toHaveLength(1);
    release.resolve();
    await expect(row(page)).toHaveCount(0);
  } finally {
    release.resolve();
  }
});

test("an uncertain deletion keeps the row until an explicit safe retry confirms it is absent", async ({
  page,
}) => {
  const fixture = await start(page);
  fixture.companyDeletionNetworkFailure = true;
  await askToDelete(page);
  await button(confirmation(page), "Delete permanently").click();
  await expect(confirmation(page).getByRole("alert")).toBeVisible();
  await expect(row(page)).toBeVisible();
  expect(fixture.companyDeletionRequests).toHaveLength(1);
  expect(fixture.companyNames[UNUSED]).toBeUndefined();
  fixture.companyDeletionNetworkFailure = false;
  await button(confirmation(page), "Delete permanently").click();
  await expect(row(page)).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Company already deleted: Unused Company" }),
  ).toBeVisible();
  expect(fixture.companyDeletionRequests).toHaveLength(2);
});

test("stale identity refreshes cannot resurrect a confirmed deletion", async ({ page }) => {
  const fixture = await start(page);
  const stale = Object.entries(fixture.companyNames).map(([id, name]) => ({
    id,
    name,
    created_at: "2026-08-01T12:34:56Z",
  }));
  await deleteConfirmed(page);
  fixture.companyCatalogRows = [
    ...stale,
    { id: EXTRA, name: "Extra Company", created_at: "2026-08-01T12:34:56Z" },
  ];
  fixture.revisions.fees = "1";
  await page.evaluate(() => globalThis.dispatchEvent(new Event("online")));
  await expect(row(page, "Extra Company")).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  fixture.companyCatalogRows = null;
  fixture.revisions.fees = "2";
  await page.evaluate(() => globalThis.dispatchEvent(new Event("online")));
  await expect(row(page, "Extra Company")).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);
  expect(fixture.companyDeletionRequests).toHaveLength(1);
});

test("deleting a company used only by unfinished drafts keeps the drafts but blocks saving the missing company", async ({
  page,
}) => {
  const fixture = await start(page);
  await tab(page, "Current fees").click();
  await openEditor(page);
  await editor(page).getByRole("combobox", { name: "Company", exact: true }).selectOption(UNUSED);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.25");
  await button(editor(page), "Add company").click();
  await closeCompanyCreation(page);
  await deleteConfirmed(page);
  await button(page, "Return to Current fees").click();
  await expect(editor(page)).toBeVisible();
  await expect(
    editor(page).getByText("This company is no longer available. Choose another company.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.25");
  await button(editor(page), "Keep draft").click();
  await button(page, "Review changes (1)").click();
  const review = page.getByRole("dialog", { name: "Review configuration changes", exact: true });
  await expect(review.getByRole("button", { name: /Save/ })).toBeDisabled();
  await button(review, "Complete S1").click();
  await expect(
    editor(page).getByText("This company is no longer available. Choose another company.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
  expect(fixture.membershipRequests).toHaveLength(0);
});

test("deleting the last row on the last page returns the directory to a populated page", async ({
  page,
}) => {
  const fixture = await start(page, (fixture) => {
    for (let i = 1; i <= 23; i++)
      fixture.companyNames[`0198b50b-701a-7000-8000-${String(i).padStart(12, "0")}`] =
        `Company ${i}`;
  });
  await button(page, "Next").click();
  await expect(row(page)).toBeVisible();
  await deleteConfirmed(page);
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await expect(row(page, "Alpha Company")).toBeVisible();
  expect(Object.keys(fixture.companyNames)).toHaveLength(25);
});

test.describe("phone deletion", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("inline confirmation and failure reasons fit the phone viewport", async ({
    page,
  }, testInfo) => {
    await start(page, (fixture) => {
      fixture.companyDeletionBlockers[UNUSED] = [{ code: "terms_versions", count: 1 }];
    });
    await askToDelete(page);
    await button(confirmation(page), "Delete permanently").tap();
    await expect(confirmation(page).getByRole("alert")).toContainText("Fee versions");
    await button(confirmation(page), "Cancel").scrollIntoViewIfNeeded();
    await expect(button(confirmation(page), "Cancel")).toBeInViewport();
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("company-deletion-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    await button(confirmation(page), "Cancel").tap();
    await expect(confirmation(page)).toHaveCount(0);
  });
});
