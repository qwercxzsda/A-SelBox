import { expect, test } from "@playwright/test";
import { assignmentId, feeRow, kioskRow, skuAssignment } from "./api-fixtures.mjs";
import {
  captureResponsiveReview,
  deferred,
  mockSupabase,
  rowWithSku,
  signIn,
} from "./fixtures.mjs";

test("Data Kiosk retains zero amounts and excludes unavailable amounts before counting", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.kioskRows = [
    ...Array.from({ length: 5 }, (_, index) => kioskRow(`ZERO-${index}`, "0.000000")),
    ...Array.from({ length: 24 }, (_, index) => kioskRow(index + 1, "1.25")),
    kioskRow("NEGATIVE", "-2.5"),
    kioskRow("UNAVAILABLE", null),
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Data Kiosk", exact: true }).click();
  const table = page.getByRole("table", { name: "Financial records" });
  await expect(table.getByRole("row")).toHaveCount(26);
  await expect(table.getByText("KIOSK-NEGATIVE", { exact: true })).toBeVisible();
  await expect(table.getByText(/KIOSK-ZERO/)).toHaveCount(5);
  await expect(table.getByText("KIOSK-UNAVAILABLE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  expect(
    fixture.requests
      .filter((request) => request.dataset === "data_kiosk")
      .at(-1)
      .params.get("amount"),
  ).toBe("not.is.null");
});

test("the complete configuration supplies every marketplace fee period without per-SKU reads", async ({
  page,
}, testInfo) => {
  const fixture = await mockSupabase(page);
  fixture.assignments = Array.from({ length: 26 }, (_, index) => skuAssignment(index + 1));
  fixture.feeRows = [
    ...Array.from({ length: 26 }, (_, index) => feeRow(index)),
    feeRow(0, assignmentId(26)),
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  const group = page.getByRole("button", {
    name: "Show marketplace fees for GROUP-001",
    exact: true,
  });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  expect(fixture.configurationRequests.filter(({ completed }) => completed)).toHaveLength(1);
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("cell", { name: "5.123456%", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Amazon.com", exact: true })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "Amazon.co.uk", exact: true })).toHaveCount(24);
  await captureResponsiveReview(page, testInfo, "fees");
  expect(fixture.configurationRequests.filter(({ completed }) => completed)).toHaveLength(1);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for GROUP-026", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for GROUP-001", exact: true }),
  ).toHaveCount(0);
});

test("visible periodic updates wait for the revision check before reloading changed data", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const before = fixture.requests.length;
  const checking = deferred();
  const release = deferred();
  fixture.beforeRevisions = async () => {
    checking.resolve();
    await release.promise;
  };
  fixture.prefixes["member-a"] = "UPDATED";
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(60_000);
  await checking.promise;
  expect(fixture.requests).toHaveLength(before);
  release.resolve();
  await expect(rowWithSku(page, "UPDATED-001")).toBeVisible();
  expect(fixture.authRequests).toBe(1);
});

test("background tabs pause periodic updates and returning to visibility refreshes", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const before = fixture.requests.length;
  await page.locator("body").evaluate((body) => {
    Object.defineProperty(body.ownerDocument, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    body.ownerDocument.dispatchEvent(new body.ownerDocument.defaultView.Event("visibilitychange"));
  });
  fixture.prefixes["member-a"] = "VISIBLE";
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(60_000);
  expect(fixture.requests).toHaveLength(before);
  await page.locator("body").evaluate((body) => {
    Object.defineProperty(body.ownerDocument, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    body.ownerDocument.dispatchEvent(new body.ownerDocument.defaultView.Event("visibilitychange"));
  });
  await expect(rowWithSku(page, "VISIBLE-001")).toBeVisible();
});

test("window focus and reconnect refresh the current account without signing in again", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  fixture.prefixes["member-a"] = "FOCUSED";
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(31_000);
  await page.evaluate(() => globalThis.dispatchEvent(new globalThis.Event("focus")));
  await expect(rowWithSku(page, "FOCUSED-001")).toBeVisible();
  fixture.prefixes["member-a"] = "RECONNECTED";
  fixture.revisions.settlement = "2";
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await expect(rowWithSku(page, "RECONNECTED-001")).toBeVisible();
  expect(fixture.authRequests).toBe(1);
});
