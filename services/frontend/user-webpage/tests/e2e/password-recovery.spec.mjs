import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { createReplies } from "./mocks/http.mjs";

const SESSION_KEY = "aselbox.auth.session.v1:https://example.invalid";
const passwordForm = (page) =>
  page.getByRole("heading", { name: "Choose a new password", exact: true });
const recoveryHash = (overrides = {}) =>
  new URLSearchParams({
    access_token: "token-member-a",
    refresh_token: "refresh-member-a",
    token_type: "bearer",
    expires_in: "3600",
    type: "recovery",
    user_id: "forged-administrator",
    role: "administrator",
    ...overrides,
  }).toString();

async function setup(page) {
  const fixture = await mockSupabase(page);
  const state = {
    requests: [],
    updates: [],
    requestStatus: 200,
    updateStatus: 200,
    beforeRequest: async () => {},
    beforeUpdate: async () => {},
  };
  await page.route("https://example.invalid/auth/v1/recover**", async (route) => {
    if (route.request().method() === "OPTIONS") return createReplies(route).reply({});
    state.requests.push({
      params: new URL(route.request().url()).searchParams,
      body: route.request().postDataJSON(),
    });
    await state.beforeRequest();
    return createReplies(route).reply(
      state.requestStatus === 200 ? {} : { message: "private-account-detail" },
      state.requestStatus,
    );
  });
  await page.route("https://example.invalid/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    state.updates.push({
      body: route.request().postDataJSON(),
      authorization: route.request().headers().authorization,
    });
    await state.beforeUpdate();
    return createReplies(route).reply(
      state.updateStatus === 200
        ? { id: "member-a", email: "member-a@example.test" }
        : { message: "private-password-detail" },
      state.updateStatus,
    );
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  return { fixture, state };
}

async function openRecovery(page, overrides = {}) {
  await page.goto(`/#${recoveryHash(overrides)}`);
  await expect(passwordForm(page)).toBeVisible();
}

test("forgot password requests a generic recovery email once and F5 never resends it", async ({
  page,
}) => {
  const { state } = await setup(page);
  const pending = deferred();
  state.beforeRequest = () => pending.promise;
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await page.getByLabel(/^Email/).fill("unknown@example.test");
  await page.getByRole("button", { name: "Send recovery link", exact: true }).click();
  await expect(page.getByLabel(/^Email/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back to sign in", exact: true })).toBeDisabled();
  pending.resolve();
  await expect(page.getByRole("status")).toContainText(
    "If an account exists for this email address",
  );
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].body).toEqual({ email: "unknown@example.test" });
  expect(state.requests[0].params.get("redirect_to")).toBe(new URL("/", page.url()).href);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reset your password", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Email/)).toHaveValue("");
  expect(state.requests).toHaveLength(1);
  expect(state.updates).toHaveLength(0);
});

test("recovery verifies identity before showing a password form and only explicit submission updates it", async ({
  page,
}, testInfo) => {
  const { fixture, state } = await setup(page);
  const hashes = [];
  fixture.beforeSessionUser = async () => {
    hashes.push(new URL(page.url()).hash);
  };
  await openRecovery(page);
  expect(new URL(page.url()).hash).toBe("");
  expect(hashes).toEqual([""]);
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(fixture.revisionRequests).toHaveLength(0);
  expect(fixture.identityRequests).toHaveLength(0);
  await page.getByLabel(/^New password/).fill("not-stored-password");
  await page.getByLabel(/^Confirm new password/).fill("different-password");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("passwords do not match");
  expect(state.updates).toHaveLength(0);
  const stored = await page.evaluate(() => Object.values(sessionStorage).join("\n"));
  expect(stored).not.toContain("not-stored-password");
  expect(stored).not.toContain("different-password");
  expect(stored).not.toContain("forged-administrator");
  await page.reload();
  await expect(passwordForm(page)).toBeVisible();
  await expect(page.getByLabel(/^New password/)).toHaveValue("");
  await expect(page.getByLabel(/^Confirm new password/)).toHaveValue("");
  expect(state.updates).toHaveLength(0);
  const pending = deferred();
  state.beforeUpdate = () => pending.promise;
  await page.getByLabel(/^New password/).fill("new-password-123");
  await page.getByLabel(/^Confirm new password/).fill("new-password-123");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByLabel(/^New password/)).toBeDisabled();
  await expect.poll(() => state.updates.length).toBe(1);
  expect(state.updates[0]).toEqual({
    body: { password: "new-password-123" },
    authorization: "Bearer token-member-a",
  });
  pending.resolve();
  await expect(page.getByRole("status")).toContainText("Your password has been updated");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Password(?:\s*\*)?$/)).toHaveValue("");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  expect(await page.evaluate(() => Object.values(sessionStorage).join("\n"))).not.toContain(
    "token-member-a",
  );
  await page.screenshot({
    path: testInfo.outputPath("password-updated.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(state.updates).toHaveLength(1);
  await signIn(page);
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
});

test("expired links and rejected recovery tokens offer a new link without exposing provider errors", async ({
  page,
}) => {
  const { fixture, state } = await setup(page);
  await page.goto("/#type=recovery&error=access_denied&error_description=private-account-detail");
  await expect(
    page.getByRole("heading", { name: "Reset your password", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(page.getByRole("alert")).not.toContainText("private-account-detail");
  expect(new URL(page.url()).hash).toBe("");
  fixture.sessionUserStatus = 401;
  await page.goto(`/#${recoveryHash()}`);
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(passwordForm(page)).toHaveCount(0);
  expect(state.requests).toHaveLength(0);
  expect(state.updates).toHaveLength(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
});

test("verification outages remain retryable after F5 without opening the workspace", async ({
  page,
}) => {
  const { fixture, state } = await setup(page);
  fixture.sessionUserStatus = 503;
  await page.goto(`/#${recoveryHash()}`);
  await expect(page.getByRole("button", { name: "Retry session", exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry session", exact: true })).toBeVisible();
  fixture.sessionUserStatus = 200;
  await page.getByRole("button", { name: "Retry session", exact: true }).click();
  await expect(passwordForm(page)).toBeVisible();
  expect(fixture.revisionRequests).toHaveLength(0);
  expect(state.updates).toHaveLength(0);
});

test("a recovery link received in an open workspace hides the old account before verification", async ({
  page,
}) => {
  const { fixture, state } = await setup(page);
  await signIn(page, "member-b");
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const verification = deferred();
  fixture.beforeSessionUser = async ({ accessToken }) => {
    if (accessToken === "token-member-a") await verification.promise;
  };
  await page.goto(`/#${recoveryHash()}`);
  await expect(page.getByRole("status").filter({ hasText: "Restoring session" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  verification.resolve();
  await expect(passwordForm(page)).toBeVisible();
  await expect(
    page.getByText("Resetting the password for member-a@example.test.", { exact: true }),
  ).toBeVisible();
  expect(fixture.revisionRequests.filter(({ user }) => user === "member-a")).toHaveLength(0);
  expect(state.updates).toHaveLength(0);
});

test("recovery renewal cannot switch to a different token user", async ({ page }) => {
  const { fixture, state } = await setup(page);
  await openRecovery(page, { expires_in: "1" });
  fixture.authSessionForRequest = () => ({
    access_token: "token-member-b",
    refresh_token: "refresh-member-b",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: "member-b", email: "member-b@example.test" },
  });
  await page.route("https://example.invalid/auth/v1/user", async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().headers().authorization === "Bearer token-member-b"
    )
      return createReplies(route).reply({ id: "member-b", email: "member-b@example.test" });
    return route.fallback();
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reset your password", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(passwordForm(page)).toHaveCount(0);
  expect(state.updates).toHaveLength(0);
  expect(fixture.revisionRequests).toHaveLength(0);
});

test("F5 during a password update does not replay the write or restore typed passwords", async ({
  page,
}) => {
  const { state } = await setup(page);
  const pending = deferred();
  state.beforeUpdate = () => pending.promise;
  await openRecovery(page);
  await page.getByLabel(/^New password/).fill("pending-password-123");
  await page.getByLabel(/^Confirm new password/).fill("pending-password-123");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect.poll(() => state.updates.length).toBe(1);
  await page.reload();
  await expect(passwordForm(page)).toBeVisible();
  await expect(page.getByLabel(/^New password/)).toHaveValue("");
  await expect(page.getByLabel(/^Confirm new password/)).toHaveValue("");
  expect(await page.evaluate(() => Object.values(sessionStorage).join("\n"))).not.toContain(
    "pending-password-123",
  );
  pending.resolve();
  expect(state.updates).toHaveLength(1);
});

test("update errors permit correction and cancellation clears the recovery session", async ({
  page,
}) => {
  const { state } = await setup(page);
  state.updateStatus = 422;
  await openRecovery(page);
  await page.getByLabel(/^New password/).fill("new-password-123");
  await page.getByLabel(/^Confirm new password/).fill("new-password-123");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not update your password");
  await expect(page.getByRole("alert")).not.toContainText("private-password-detail");
  await expect(page.getByLabel(/^New password/)).toBeEnabled();
  await page.getByRole("button", { name: "Cancel and return to sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  await page.reload();
  await expect(passwordForm(page)).toHaveCount(0);
  expect(state.updates).toHaveLength(1);
});

for (const status of [401, 403]) {
  test(`a rejected password update (${status}) returns to the recovery request form`, async ({
    page,
  }) => {
    const { state } = await setup(page);
    state.updateStatus = status;
    await openRecovery(page);
    await page.getByLabel(/^New password/).fill("new-password-123");
    await page.getByLabel(/^Confirm new password/).fill("new-password-123");
    await page.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Reset your password", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Request a new link below");
    await expect(page.getByLabel(/^Email/)).toHaveValue("member-a@example.test");
    await expect(page.getByRole("button", { name: "Send recovery link" })).toBeEnabled();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
    expect(state.updates).toHaveLength(1);
    expect(state.requests).toHaveLength(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Reset your password", exact: true }),
    ).toBeVisible();
    expect(state.updates).toHaveLength(1);
    expect(state.requests).toHaveLength(0);
  });
}
