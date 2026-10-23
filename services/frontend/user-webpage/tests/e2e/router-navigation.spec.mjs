import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

test("workspace deep links retain subpaths, repeated literal filters and unrelated URL state", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = ["001", "null", "A+B"].map((sku, index) => ({
    ...liveRow("ROUTE", index + 1),
    sku,
  }));
  fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
  await page.goto("/app?tab=live&sku=001&sku=null&campaign=a&campaign=b#notes");
  await signIn(page);
  await expect(rowWithSku(page, "001")).toBeVisible();
  await expect(rowWithSku(page, "null")).toBeVisible();
  await expect(rowWithSku(page, "A+B")).toHaveCount(0);
  expect(fixture.requests.at(-1).args.p_skus).toEqual(["001", "null"]);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/app");
  expect(url.searchParams.getAll("sku")).toEqual(["001", "null"]);
  expect(url.searchParams.getAll("campaign")).toEqual(["a", "b"]);
  expect(url.hash).toBe("#notes");
  await page.reload();
  await expect(rowWithSku(page, "001")).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll("sku")).toEqual(["001", "null"]);
});

test("typing replaces the current history entry while paging and tab changes remain traversable", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 80;
  fixture.assignments = skuAssignments(
    Array.from({ length: 80 }, (_, index) => `ALPHA-${String(index + 1).padStart(3, "0")}`),
  );
  await mockInventory(page, [inventoryRow("QA-001")]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const entries = await page.evaluate(() => globalThis.history.length);
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("AL");
  await expect(page).toHaveURL(/search=AL(?:&|$)/);
  await search.fill("ALPHA");
  await expect(page).toHaveURL(/search=ALPHA(?:&|$)/);
  expect(await page.evaluate(() => globalThis.history.length)).toBe(entries);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  expect(await page.evaluate(() => globalThis.history.length)).toBe(entries + 1);
  await page.goBack();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(search).toHaveValue("ALPHA");
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goForward();
  await expect(search).toHaveValue("ALPHA");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
});

test("signing out during a page request clears routed state without losing unrelated URL data", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await page.goto("/app?campaign=help#notes");
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const started = deferred();
  const release = deferred();
  fixture.beforeDataset = async () => {
    started.resolve();
    await release.promise;
  };
  try {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await started.promise;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    release.resolve();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/app\?campaign=help#notes$/);
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get("tab")).toBe("live");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("campaign")).toBe("help");
    expect(url.hash).toBe("#notes");
  } finally {
    release.resolve();
  }
});
