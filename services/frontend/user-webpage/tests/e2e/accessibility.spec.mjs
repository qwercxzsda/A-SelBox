import { expect, test } from "./accessibility-fixture.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";
import { openSourceLookup, sourceDetail } from "./financial-source-fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { editor, openEditor, openReview, review, setup } from "./sku-configuration-fixtures.mjs";

for (const mode of ["sign-in", "sign-up", "recover"]) {
  test(`accessibility: ${mode} form`, async ({ page, expectAccessible }) => {
    await mockSupabase(page);
    if (mode !== "sign-in") {
      await page
        .getByRole("button", {
          name: mode === "sign-up" ? "New to A-SelBox? Create an account" : "Forgot password?",
          exact: true,
        })
        .click();
    }
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
    await expectAccessible(mode);
  });
}

test("accessibility: sign-in error feedback on a phone", async ({ page, expectAccessible }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSupabase(page);
  await page.route("**/auth/v1/token*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "These credentials could not be verified." }),
    }),
  );
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("qa@example.test");
  await page.getByLabel(/^Password/).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expectAccessible("sign-in-error-phone");
});

for (const role of ["member", "administrator"]) {
  test(`accessibility: ${role} transactions and type filter`, async ({
    page,
    expectAccessible,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expectAccessible(`${role}-transactions`);
    const filter = await openColumn(page, "Type");
    await expect(filter.getByRole("checkbox").first()).toBeVisible();
    await expectAccessible(`${role}-type-filter`);
  });
}

test("accessibility: source lookup and retained source detail", async ({
  page,
  expectAccessible,
}) => {
  const { opener } = await openSourceLookup(page);
  await expectAccessible("source-lookup");
  await opener.click();
  await expect(
    sourceDetail(page).getByRole("heading", { name: "RETAINED-00", exact: true }),
  ).toBeVisible();
  await expectAccessible("retained-source-detail");
});

test("accessibility: source error and recovery action", async ({ page, expectAccessible }) => {
  const { state, opener } = await openSourceLookup(page);
  state.status = 403;
  await opener.click();
  await expect(sourceDetail(page).getByRole("alert")).toBeVisible();
  await expectAccessible("source-error");
});

test("accessibility: financial review and monthly detail", async ({ page, expectAccessible }) => {
  await openFinancialReview(page);
  const openMonth = page.getByRole("button", { name: "Open review for July 2026", exact: true });
  await expect(openMonth).toBeVisible();
  await expectAccessible("financial-review");
  await openMonth.click();
  const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(monthly.getByRole("table", { name: "Amounts by type", exact: true })).toBeVisible();
  await expectAccessible("monthly-review-detail");
});

test("accessibility: fee editor and change review on a phone", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await openEditor(page);
  const rate = editor(page).getByLabel("Fee rate 1 (%)", { exact: true });
  await expect(rate).toHaveValue("5");
  await expectAccessible("fee-editor-phone");
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const preview = editor(page).getByRole("region", { name: "Change rate from date", exact: true });
  await preview.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
  await preview.getByLabel("New fee rate (%)", { exact: true }).fill("6.25");
  await preview.getByRole("button", { name: "Preview rate change", exact: true }).click();
  const apply = preview.getByRole("button", { name: "Use rate change in draft", exact: true });
  await expect(apply).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  await expectAccessible("fee-rate-preview-phone");
  await apply.click();
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeVisible();
  await expectAccessible("fee-review-phone");
});

test("accessibility: companies and member assignment", async ({ page, expectAccessible }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await signIn(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toBeVisible();
  await expectAccessible("companies");
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  const member = page.getByRole("row").filter({
    has: page.getByText("member-b@example.test", { exact: true }),
  });
  await expect(member).toBeVisible();
  await expectAccessible("user-access");
  await member.click();
  const membership = page.getByRole("dialog", { name: "Company membership", exact: true });
  await expect(membership.getByRole("combobox", { name: "Company", exact: true })).toBeVisible();
  await expectAccessible("membership-editor");
});
