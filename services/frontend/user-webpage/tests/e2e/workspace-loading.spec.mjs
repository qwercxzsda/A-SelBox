import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku } from "./fixtures.mjs";

test("a failed workspace download offers reload and restores the verified session", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  let attempts = 0;
  await page.route(
    (url) => url.pathname === "/src/AuthenticatedWorkspace.tsx",
    async (route) => {
      attempts += 1;
      if (attempts === 1) return route.abort("failed");
      return route.continue();
    },
  );

  await page.getByLabel(/^Email/).fill("member-a@example.test");
  await page.getByLabel(/^Password/).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const reload = page.getByRole("button", { name: "Reload workspace", exact: true });
  await expect(reload).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(fixture.authRequests).toBe(1);
  expect(fixture.identityRequests).toHaveLength(3);

  await reload.click();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.locator("header")).toContainText("member-a@example.test");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(fixture.authRequests).toBe(1);
  expect(fixture.sessionUserRequests).toEqual([
    { user: "member-a", accessToken: "token-member-a" },
  ]);
  expect(fixture.identityRequests).toHaveLength(6);
});
