import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import { setup, item, stageRate, openReview, review } from "./sku-configuration-fixtures.mjs";

test("a save completing after token renewal refreshes only with current credentials", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await setup(page, "operator", [item("S1")], (state) => {
    state.authSessionForRequest = ({ grantType, user }) => ({
      access_token: grantType === "password" ? "initial-access" : "renewed-access",
      refresh_token: grantType === "password" ? "initial-refresh" : "renewed-refresh",
      token_type: "bearer",
      expires_in: grantType === "password" ? 90 : 3600,
      user: { id: user, email: `${user}@example.test` },
    });
  });
  await stageRate(page);
  const pending = deferred();
  fixture.beforeConfigurationSave = () => pending.promise;
  await openReview(page);
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await expect.poll(() => fixture.configurationSaves.length).toBe(1);
  await page
    .getByRole("tab", { name: "Transactions", exact: true })
    .evaluate((element) => element.click());
  await page.clock.fastForward(30_000);
  await expect
    .poll(() =>
      fixture.identityRequests.some(({ accessToken }) => accessToken === "renewed-access"),
    )
    .toBe(true);
  const requestsBeforeCompletion = fixture.revisionRequests.length;
  const configurationBeforeCompletion = fixture.configurationRequests.length;
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  pending.resolve();
  await expect(page.getByRole("status").filter({ hasText: "1 SKU change saved." })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Refreshing saved settings…" }),
  ).toBeHidden();
  expect(
    fixture.revisionRequests
      .slice(requestsBeforeCompletion)
      .every(({ accessToken }) => accessToken === "renewed-access"),
  ).toBe(true);
  expect(
    fixture.configurationRequests
      .slice(configurationBeforeCompletion)
      .every(({ accessToken }) => accessToken === "renewed-access"),
  ).toBe(true);
  expect(fixture.configurationSaves).toHaveLength(1);
});
