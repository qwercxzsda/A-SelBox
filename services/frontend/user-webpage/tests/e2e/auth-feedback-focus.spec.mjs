import { expect, test } from "@playwright/test";
import { mockSupabase } from "./fixtures.mjs";

for (const mode of ["sign-in", "sign-up"]) {
  test(`${mode} failure brings its feedback into view and keeps entered values`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await mockSupabase(page);
    await page.route(`**/auth/v1/${mode === "sign-in" ? "token*" : "signup*"}`, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "These credentials could not be verified." }),
      }),
    );
    if (mode === "sign-up")
      await page
        .getByRole("button", { name: "New to A-SelBox? Create an account", exact: true })
        .click();
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    const password = page.getByLabel(/^Password/);
    await email.fill("qa@example.test");
    await password.fill("synthetic-password");
    await page
      .getByRole("button", { name: mode === "sign-in" ? "Sign in" : "Create account", exact: true })
      .press("Enter");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toBeInViewport();
    await expect(alert).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(email).toBeFocused();
    await expect(email).toHaveValue("qa@example.test");
    await expect(password).toHaveValue("synthetic-password");
    await page.screenshot({
      path: testInfo.outputPath(`${mode}-feedback-phone.png`),
      animations: "disabled",
    });
  });
}
