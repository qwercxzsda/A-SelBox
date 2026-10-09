import { expect, test } from "@playwright/test";
import { captureResponsiveReview, deferred, mockSupabase } from "./fixtures.mjs";

const SESSION_KEY = "aselbox.auth.session.v1:https://example.invalid";
const email = "member-a@example.test";
const password = "new-account-password";

async function fillSignup(page) {
  await page.getByRole("button", { name: "New to A-SelBox? Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Password/)).toHaveAttribute("autocomplete", "new-password");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
}

test("confirmation-required signup explains the next step without storing a session or loading company data", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  const calls = [];
  await page.route("https://example.invalid/auth/v1/signup**", async (route) => {
    calls.push(route.request().postDataJSON());
    const redirect = new URL(route.request().url()).searchParams.get("redirect_to");
    expect(redirect).toBe("http://127.0.0.1:4173/");
    await route.fulfill({ json: { id: "member-a", email } });
  });
  await fillSignup(page);
  await captureResponsiveReview(page, testInfo, "email-signup");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Password/)).toHaveValue("");
  await expect(page.getByLabel(/^Password/)).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(calls).toEqual([{ email, password }]);
  expect(fixture.revisionRequests).toHaveLength(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  await captureResponsiveReview(page, testInfo, "email-confirmation-pending");
});

test("immediate signup opens an Unassigned account and does not fetch company catalogs or financial data", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "unassigned";
  await page.route("https://example.invalid/auth/v1/signup**", (route) =>
    route.fulfill({
      json: {
        access_token: "token-member-a",
        refresh_token: "refresh-member-a",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: "member-a", email },
      },
    }),
  );
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.locator("header")).toContainText("Unassigned");
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(fixture.identityRequests).toHaveLength(0);
  expect(fixture.requests).toHaveLength(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).not.toContain(
    password,
  );
});

test("signup prevents duplicate submission and shows safe errors while allowing correction", async ({
  page,
}) => {
  await mockSupabase(page);
  const pending = deferred();
  let calls = 0;
  await page.route("https://example.invalid/auth/v1/signup**", async (route) => {
    calls += 1;
    await pending.promise;
    await route.fulfill({ status: 422, json: { message: "private account details" } });
  });
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel(/^Email/)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Already have an account? Sign in" }),
  ).toBeDisabled();
  pending.resolve();
  await expect(page.getByRole("alert")).toContainText(
    "Could not create an account with these details",
  );
  await expect(page.getByRole("alert")).not.toContainText("private account details");
  expect(calls).toBe(1);
  await expect(page.getByLabel(/^Email/)).toBeEnabled();
  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel(/^Email/)).toHaveValue(email);
  await expect(page.getByLabel(/^Password/)).toHaveValue("");
});

test("email confirmation verifies Auth identity and removes tokens from the URL before opening the workspace", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "unassigned";
  const params = new URLSearchParams({
    access_token: "token-member-a",
    refresh_token: "refresh-member-a",
    token_type: "bearer",
    expires_in: "3600",
    type: "signup",
    user_id: "administrator",
  });
  await page.goto(`/#${params}`);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.locator("header")).toContainText(email);
  await expect(page.locator("header")).toContainText("Unassigned");
  expect(new URL(page.url()).hash).toBe("");
  expect(fixture.sessionUserRequests).toEqual([
    { user: "member-a", accessToken: "token-member-a" },
  ]);
  expect(fixture.identityRequests).toHaveLength(0);
});

test("expired confirmation displays a safe recovery message and removes error payloads from the URL", async ({
  page,
}) => {
  await mockSupabase(page);
  await page.goto("/#error=access_denied&error_description=private-details");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(page.getByRole("alert")).not.toContainText("private-details");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});
