import { expect, test } from "@playwright/test";
import { mockSupabase } from "./fixtures.mjs";

for (const width of [390, 1280]) {
  test(`switching sign-in and signup starts keyboard navigation at the form at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const fixture = await mockSupabase(page);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("qa@example.test");
    await page
      .getByRole("button", { name: "New to A-SelBox? Create an account", exact: true })
      .press("Enter");
    await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
      "qa@example.test",
    );
    await page
      .getByRole("button", { name: "Already have an account? Sign in", exact: true })
      .press("Enter");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
    expect(fixture.authRequests).toBe(0);
  });
}
