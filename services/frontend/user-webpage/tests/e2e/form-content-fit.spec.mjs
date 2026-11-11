import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { createReplies } from "./mocks/http.mjs";
import {
  COMPANY,
  OTHER_COMPANY,
  editor,
  openEditor,
  openReview,
  review,
  setup,
} from "./sku-configuration-fixtures.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";

async function expectContained(page, scope) {
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
  expect(await scope.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
}

async function expectActionFits(button) {
  await button.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expectFullyInViewport(button);
  expect(
    await button
      .locator(".mantine-Button-label")
      .evaluate(
        (label) =>
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
      ),
  ).toBe(true);
}

async function enlargeText(page, size) {
  if (size !== 16) await page.addStyleTag({ content: `html { font-size: ${size}px; }` });
}

for (const [width, textSize] of [
  [320, 16],
  [390, 24],
]) {
  test(`auth forms keep their actions and password toggle reachable at ${width}px with ${textSize}px text`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    await enlargeText(page, textSize);
    const panel = page.locator(".login-shell > section");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("sign-in.png"),
      fullPage: true,
      animations: "disabled",
    });
    await expectContained(page, panel);
    const password = page.getByLabel(/^Password/);
    await password.fill("synthetic-password");
    await password.focus();
    await page.keyboard.press("Tab");
    const toggle = page.getByRole("button", { name: "Toggle password visibility", exact: true });
    await expect(toggle).toBeFocused();
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    const createAccount = page.getByRole("button", {
      name: "New to A-SelBox? Create an account",
      exact: true,
    });
    await expectActionFits(createAccount);
    await createAccount.press("Enter");
    await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeFocused();
    await expectContained(page, panel);
    const signInAction = page.getByRole("button", {
      name: "Already have an account? Sign in",
      exact: true,
    });
    await expectActionFits(signInAction);
    await signInAction.press("Enter");
    await page.getByRole("button", { name: "Forgot password?", exact: true }).press("Enter");
    await expect(
      page.getByRole("heading", { name: "Reset your password", exact: true }),
    ).toBeFocused();
    await expectContained(page, panel);
    await expectActionFits(page.getByRole("button", { name: "Send recovery link", exact: true }));
    await expectActionFits(page.getByRole("button", { name: "Back to sign in", exact: true }));
    expect(fixture.authRequests).toBe(0);
  });

  test(`recovery keeps a long email and validation usable at ${width}px with ${textSize}px text`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockSupabase(page);
    const email = `${"x".repeat(60)}@${"y".repeat(60)}.example.test`;
    await page.route("https://example.invalid/auth/v1/user", (route) =>
      createReplies(route).reply({ id: "member-a", email }),
    );
    const hash = new URLSearchParams({
      access_token: "token-member-a",
      refresh_token: "refresh-member-a",
      token_type: "bearer",
      expires_in: "3600",
      type: "recovery",
    });
    await page.goto(`/#${hash}`);
    await expect(
      page.getByRole("heading", { name: "Choose a new password", exact: true }),
    ).toBeFocused();
    await enlargeText(page, textSize);
    const panel = page.locator(".login-shell > section");
    await page.screenshot({
      path: testInfo.outputPath("recovery-long-email.png"),
      fullPage: true,
      animations: "disabled",
    });
    await expectContained(page, panel);
    await expect(panel).toContainText(`Resetting the password for ${email}.`);
    const password = page.getByLabel(/^New password/);
    const confirmation = page.getByLabel(/^Confirm new password/);
    await password.fill("new-password-123");
    await password.press("Tab");
    const toggles = page.getByRole("button", { name: "Toggle password visibility", exact: true });
    await expect(toggles.nth(0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await page.keyboard.press("Tab");
    await expect(confirmation).toBeFocused();
    await confirmation.fill("different-password");
    await confirmation.press("Tab");
    await expect(toggles.nth(1)).toBeFocused();
    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Update password", exact: true });
    await expect(submit).toBeFocused();
    await expectActionFits(submit);
    await submit.press("Enter");
    await expect(confirmation).toBeFocused();
    await expect(page.getByRole("alert")).toHaveText("The passwords do not match.");
    await expect(page.getByRole("alert")).toBeInViewport();
    await expectActionFits(
      page.getByRole("button", { name: "Request a new recovery link", exact: true }),
    );
    await expectActionFits(
      page.getByRole("button", { name: "Cancel and return to sign in", exact: true }),
    );
    await expectContained(page, panel);
  });

  test(`long company names leave membership confirmation readable at ${width}px with ${textSize}px text`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    const userId = "00000000-0000-4000-8000-000000000001";
    const company = "Company" + "X".repeat(160);
    fixture.roles["member-a"] = "administrator";
    fixture.roles[userId] = "member";
    fixture.accountEmails[userId] = "qa-member@example.test";
    fixture.companyIds[userId] = COMPANY;
    fixture.companyNames[COMPANY] = company;
    await signIn(page);
    await enlargeText(page, textSize);
    await page.getByRole("tab", { name: "User access", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ has: page.getByText("qa-member@example.test", { exact: true }) })
      .click();
    const drawer = page.getByRole("dialog", { name: "Company membership", exact: true });
    await page.screenshot({
      path: testInfo.outputPath("membership-company-name.png"),
      animations: "disabled",
    });
    await expectContained(page, drawer);
    const revoke = drawer.getByRole("button", { name: "Revoke membership", exact: true });
    await revoke.press("Enter");
    const confirmation = drawer.getByRole("alert");
    await expect(confirmation).toBeFocused();
    await expect(confirmation).toContainText(company);
    await expectContained(page, drawer);
    await expectActionFits(drawer.getByRole("button", { name: "Confirm revocation", exact: true }));
    const keep = drawer.getByRole("button", { name: "Keep membership", exact: true });
    await expectActionFits(keep);
    await page.screenshot({
      path: testInfo.outputPath("membership-confirmation.png"),
      animations: "disabled",
    });
    await keep.press("Enter");
    await expect(revoke).toBeFocused();
    expect(fixture.membershipRequests).toHaveLength(0);
  });
}

test("fee list and review wrap company names without hiding actions on a phone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const previous = "Previous" + "X".repeat(160);
  const next = "Next" + "Y".repeat(160);
  const fixture = await setup(page, "administrator", undefined, (state) => {
    state.companyNames[COMPANY] = previous;
    state.companyNames[OTHER_COMPANY] = next;
  });
  const company = page
    .getByRole("table", { name: "Current fee configurations", exact: true })
    .getByRole("cell", { name: previous, exact: true });
  await company.scrollIntoViewIfNeeded();
  await expectFullyInViewport(company);
  await expectContained(page, company);
  await expectActionFits(page.getByRole("button", { name: "Edit S1", exact: true }));
  await page.screenshot({
    path: testInfo.outputPath("fee-list-company-name.png"),
    fullPage: true,
    animations: "disabled",
  });
  await openEditor(page);
  await editor(page).getByLabel("Company", { exact: true }).selectOption(OTHER_COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  const card = review(page).locator(".sku-configuration-card");
  await page.screenshot({
    path: testInfo.outputPath("review-company-change.png"),
    animations: "disabled",
  });
  await expectContained(page, card);
  await expect(card).toContainText(`Company: ${previous} → ${next}`);
  await expectActionFits(
    review(page).getByRole("button", { name: "Back to editing", exact: true }),
  );
  await expectActionFits(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  );
  expect(fixture.configurationSaves).toHaveLength(0);
});
