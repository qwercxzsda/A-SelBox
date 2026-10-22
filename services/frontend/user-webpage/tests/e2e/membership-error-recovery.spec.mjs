import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

const targetUser = "00000000-0000-4000-8000-000000000001";
const northCompany = "00000000-0000-4000-8000-00000000000a";
const southCompany = "00000000-0000-4000-8000-00000000000b";

async function selectMembership(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.roles[targetUser] = "unassigned";
  fixture.accountEmails[targetUser] = "concurrent-member@example.test";
  fixture.companyIds[targetUser] = null;
  fixture.companyNames[northCompany] = "North Company";
  fixture.companyNames[southCompany] = "South Company";
  await signIn(page);
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "concurrent-member@example.test" });
  await row.click();
  const drawer = page.getByRole("dialog", { name: "Company membership", exact: true });
  const company = drawer.getByRole("combobox", { name: "Company", exact: true });
  await company.fill("North Company");
  await page.getByRole("option", { name: "North Company", exact: true }).click();
  return { fixture, row, drawer, company };
}

test("a concurrent membership change keeps its explanation after the latest account is loaded", async ({
  page,
}) => {
  const { fixture, row, drawer, company } = await selectMembership(page);
  fixture.roles[targetUser] = "member";
  fixture.companyIds[targetUser] = southCompany;
  await drawer.getByRole("button", { name: "Save membership", exact: true }).click();
  await expect(company).toHaveValue("South Company");
  await expect(row).toContainText("South Company");
  const problem = drawer.getByRole("alert");
  await expect(problem).toContainText("This user's access changed while you were editing.");
  await expect(problem).toBeFocused();
  expect(fixture.membershipRequests).toHaveLength(1);
  expect(fixture.companyIds[targetUser]).toBe(southCompany);
  await company.fill("North Company");
  await page.getByRole("option", { name: "North Company", exact: true }).click();
  await drawer.getByRole("button", { name: "Save membership", exact: true }).click();
  await expect(
    drawer.getByRole("status").filter({ hasText: "Company membership saved." }),
  ).toBeVisible();
  await expect(problem).toHaveCount(0);
  expect(fixture.membershipRequests).toHaveLength(2);
});

test("an uncertain membership response stays explained after a committed assignment is refreshed", async ({
  page,
}) => {
  const { fixture, row, drawer, company } = await selectMembership(page);
  fixture.membershipStatus = 503;
  fixture.beforeMembership = () => {
    fixture.roles[targetUser] = "member";
    fixture.companyIds[targetUser] = northCompany;
  };
  await drawer.getByRole("button", { name: "Save membership", exact: true }).click();
  await expect(row).toContainText("North Company");
  await expect(company).toHaveValue("North Company");
  const problem = drawer.getByRole("alert");
  await expect(problem).toContainText("Could not confirm whether membership changed.");
  await expect(problem).toBeFocused();
  await expect(drawer.getByRole("button", { name: "Save membership", exact: true })).toBeDisabled();
  expect(fixture.membershipRequests).toHaveLength(1);
});
