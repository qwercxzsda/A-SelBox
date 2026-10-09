import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

test("a stalled sign-in stops waiting, never replays automatically, and allows another attempt", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const gate = deferred();
  fixture.beforeAuth = () => gate.promise;
  try {
    await page.getByLabel(/^Email/).fill("member-a@example.test");
    await page.getByLabel(/^Password/).fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect.poll(() => fixture.authRequests).toBe(1);
    await page.clock.fastForward(30_001);
    await expect(page.getByRole("alert")).toContainText("Sign in timed out");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await page.clock.fastForward(60_000);
    expect(fixture.authRequests).toBe(1);
    fixture.beforeAuth = async () => {};
    gate.resolve();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    expect(fixture.authRequests).toBe(2);
  } finally {
    gate.resolve();
  }
});

test("a stalled session restore preserves credentials and recovers through Retry session", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const started = deferred();
  const gate = deferred();
  fixture.beforeSessionUser = async () => {
    started.resolve();
    await gate.promise;
  };
  try {
    await page.reload();
    await started.promise;
    await page.clock.fastForward(30_001);
    await expect(page.getByRole("alert")).toContainText("Session verification timed out");
    await expect(page.getByRole("tab")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("aselbox.auth.session.v1:https://example.invalid"),
      ),
    ).not.toBeNull();
    fixture.beforeSessionUser = async () => {};
    gate.resolve();
    await page.getByRole("button", { name: "Retry session", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    expect(fixture.authRequests).toBe(1);
    expect(fixture.sessionUserRequests).toHaveLength(2);
  } finally {
    gate.resolve();
  }
});
