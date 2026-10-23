import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";

const targetUser = "00000000-0000-4000-8000-000000000001";
const companyId = "00000000-0000-4000-8000-00000000000a";
const otherUser = "00000000-0000-4000-8000-000000000002";
const drawer = (page) => page.getByRole("dialog", { name: "Company membership", exact: true });
const accountRow = (page) =>
  page.getByRole("row").filter({ hasText: "pending-member@example.test" });

async function startAssignment(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.roles[targetUser] = "unassigned";
  fixture.accountEmails[targetUser] = "pending-member@example.test";
  fixture.companyIds[targetUser] = null;
  fixture.companyNames[companyId] = "North Company";
  fixture.roles[otherUser] = "unassigned";
  fixture.companyIds[otherUser] = null;
  fixture.accountEmails[otherUser] = "other-member@example.test";
  await signIn(page);
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await accountRow(page).click();
  await drawer(page).getByRole("combobox", { name: "Company", exact: true }).fill("North Company");
  await page.getByRole("option", { name: "North Company", exact: true }).click();
  return fixture;
}

test("a pending membership failure survives switching tabs and can be corrected", async ({
  page,
}) => {
  const fixture = await startAssignment(page);
  const response = deferred();
  fixture.membershipStatus = 503;
  fixture.beforeMembership = () => response.promise;
  try {
    await drawer(page).getByRole("button", { name: "Save membership", exact: true }).click();
    await expect.poll(() => fixture.membershipRequests.length).toBe(1);
    await drawer(page)
      .getByRole("button", { name: "Close membership details", exact: true })
      .click();
    await page.getByRole("tab", { name: "Companies", exact: true }).click();
    await page.getByRole("tab", { name: "User access", exact: true }).click();
    await accountRow(page).click();
    const save = drawer(page).getByRole("button", { name: "Save membership", exact: true });
    await expect(save).toBeDisabled();
    response.resolve();
    await expect(drawer(page).getByRole("alert")).toContainText(
      "Could not confirm whether membership changed.",
    );
    await expect(save).toBeEnabled();
    fixture.membershipStatus = 200;
    await save.click();
    await expect(accountRow(page)).toContainText("North Company");
    await expect(drawer(page).getByRole("alert")).toHaveCount(0);
    expect(fixture.membershipRequests).toHaveLength(2);
  } finally {
    response.resolve();
  }
});

test("a membership completion cannot change another account's draft or feedback", async ({
  page,
}) => {
  const fixture = await startAssignment(page);
  const response = deferred();
  fixture.beforeMembership = () => response.promise;
  try {
    await drawer(page).getByRole("button", { name: "Save membership", exact: true }).click();
    await expect.poll(() => fixture.membershipRequests.length).toBe(1);
    await drawer(page)
      .getByRole("button", { name: "Close membership details", exact: true })
      .click();
    const other = page.getByRole("row").filter({ hasText: "other-member@example.test" });
    await other.click();
    const company = drawer(page).getByRole("combobox", { name: "Company", exact: true });
    await expect(company).toBeEnabled();
    await company.fill("North Company");
    await page.getByRole("option", { name: "North Company", exact: true }).click();
    response.resolve();
    await expect(accountRow(page)).toContainText("North Company");
    await expect(company).toHaveValue("North Company");
    await expect(drawer(page).getByRole("status")).toContainText("Unsaved change");
    await expect(drawer(page).getByText("Company membership saved.", { exact: true })).toHaveCount(
      0,
    );
    expect(fixture.roles[otherUser]).toBe("unassigned");
    expect(fixture.membershipRequests).toHaveLength(1);
    await drawer(page)
      .getByRole("button", { name: "Close membership details", exact: true })
      .click();
    await other.click();
    await expect(company).toHaveValue("North Company");
  } finally {
    response.resolve();
  }
});

for (const status of [200, 503]) {
  test(`reopening a pending membership save (${status}) keeps it exclusive and reports its result`, async ({
    page,
  }) => {
    const fixture = await startAssignment(page);
    const response = deferred();
    fixture.membershipStatus = status;
    fixture.beforeMembership = () => response.promise;
    try {
      await drawer(page).getByRole("button", { name: "Save membership", exact: true }).click();
      await expect.poll(() => fixture.membershipRequests.length).toBe(1);
      await drawer(page)
        .getByRole("button", { name: "Close membership details", exact: true })
        .click();
      await expect(drawer(page)).toBeHidden();
      await accountRow(page).click();
      const save = drawer(page).getByRole("button", { name: "Save membership", exact: true });
      await expect(save).toBeDisabled();
      await expect(
        drawer(page).getByRole("combobox", { name: "Company", exact: true }),
      ).toBeDisabled();
      expect(fixture.membershipRequests).toHaveLength(1);
      response.resolve();
      if (status === 503) {
        await expect(drawer(page).getByRole("alert")).toContainText(
          "Could not confirm whether membership changed.",
        );
        await expect(save).toBeEnabled();
        await expect(
          drawer(page).getByRole("combobox", { name: "Company", exact: true }),
        ).toHaveValue("North Company");
      } else {
        await expect(accountRow(page)).toContainText("North Company");
        await expect(drawer(page).getByRole("status")).toContainText("Company membership saved.");
        await drawer(page).getByRole("button", { name: "Revoke membership", exact: true }).click();
        await drawer(page).getByRole("button", { name: "Confirm revocation", exact: true }).click();
        await expect(accountRow(page)).toContainText("Unassigned");
        await expect(
          drawer(page).getByRole("combobox", { name: "Company", exact: true }),
        ).toHaveValue("");
        await expect(save).toBeDisabled();
      }
    } finally {
      response.resolve();
    }
  });
}

test("an earlier account's late completion cannot replace the current account's success", async ({
  page,
}) => {
  const fixture = await startAssignment(page);
  const response = deferred();
  fixture.beforeMembership = ({ body }) =>
    body.target_user_id === targetUser ? response.promise : Promise.resolve();
  try {
    await drawer(page).getByRole("button", { name: "Save membership", exact: true }).click();
    await expect.poll(() => fixture.membershipRequests.length).toBe(1);
    await drawer(page)
      .getByRole("button", { name: "Close membership details", exact: true })
      .click();
    await page.getByRole("row").filter({ hasText: "other-member@example.test" }).click();
    await drawer(page)
      .getByRole("combobox", { name: "Company", exact: true })
      .fill("North Company");
    await page.getByRole("option", { name: "North Company", exact: true }).click();
    await drawer(page).getByRole("button", { name: "Save membership", exact: true }).click();
    const success = drawer(page)
      .getByRole("status")
      .filter({ hasText: "Company membership saved." });
    await expect(success).toBeVisible();
    response.resolve();
    await expect(accountRow(page)).toContainText("North Company");
    await expect(success).toBeVisible();
    await expect(success).toBeFocused();
    expect(fixture.membershipRequests).toHaveLength(2);
    expect(fixture.companyIds[otherUser]).toBe(companyId);
  } finally {
    response.resolve();
  }
});
