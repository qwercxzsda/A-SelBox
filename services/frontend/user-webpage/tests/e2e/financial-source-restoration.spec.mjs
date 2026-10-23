import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import { openSourceLookup, sourceDetail } from "./financial-source-fixtures.mjs";

async function secondPage(page) {
  const lookup = await openSourceLookup(page, {
    count: 55,
    configure: (state) => {
      state.rows.forEach((row, index) => {
        row.amount = String(index + 1);
      });
    },
  });
  await page.getByRole("button", { name: "Next matches", exact: true }).click();
  await expect(lookup.table.locator("tbody tr").first()).toContainText("26.00");
  return lookup;
}

test("source lookup preserves its page across workspace tabs and reloads", async ({
  page,
}, testInfo) => {
  const { table } = await secondPage(page);
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await page.getByRole("tab", { name: "Finances", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("26.00");
  await page.reload();
  await expect(table.locator("tbody tr").first()).toContainText("26.00");
  await page
    .getByRole("region", { name: "Amazon transaction results", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("restored-source-page.png"),
    animations: "disabled",
  });
});

test("closing a restored source record keeps the original lookup page", async ({ page }) => {
  const { table, opener } = await secondPage(page);
  await opener.click();
  await expect(sourceDetail(page)).toBeVisible();
  await page.reload();
  await expect(sourceDetail(page)).toBeVisible();
  await sourceDetail(page).getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("26.00");
});

test("an empty restored later lookup page explains its scope and keeps Previous", async ({
  page,
}) => {
  const { state, table } = await secondPage(page);
  state.rows = state.rows.slice(0, 10);
  await page.reload();
  await expect(
    page.getByText("No matches on this page. Return to the previous page to see earlier matches.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous matches", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await expect(table.locator("tbody tr").first()).toContainText("1.00");
});

test("retrying an unavailable source record moves focus to the recovered record", async ({
  page,
}) => {
  const { state, opener } = await openSourceLookup(page);
  state.status = 403;
  await opener.click();
  const drawer = sourceDetail(page);
  await expect(drawer.getByRole("alert")).toContainText("Could not load source record.");
  state.status = 200;
  await drawer.getByRole("button", { name: "Retry source record", exact: true }).press("Enter");
  await expect(drawer.getByRole("heading", { name: "RETAINED-00", exact: true })).toBeFocused();
});

test("an open source record exposes a failed background refresh and allows retry", async ({
  page,
}) => {
  await page.clock.install();
  const { fixture, state, opener } = await openSourceLookup(page);
  await opener.click();
  const drawer = sourceDetail(page);
  await expect(drawer.getByRole("heading", { name: "RETAINED-00", exact: true })).toBeVisible();
  state.status = 503;
  fixture.revisions.finances = "next-source";
  await page.clock.fastForward(60_000);
  await expect.poll(() => state.requests.filter((args) => args.p_row_id).length).toBeGreaterThan(1);
  await expect(drawer.getByRole("alert")).toContainText("Could not load source record.");
  await expect(drawer.getByRole("heading", { name: "RETAINED-00", exact: true })).toBeVisible();
  state.status = 200;
  await drawer.getByRole("button", { name: "Retry source record", exact: true }).click();
  await expect(drawer.getByRole("alert")).toBeHidden();
  await expect(drawer.getByRole("group", { name: "source record", exact: true })).toBeFocused();
});

test("a fresh transaction search starts at its first page", async ({ page }) => {
  const { state, table } = await secondPage(page);
  const nextId = "ANOTHER-EXACT-TRANSACTION";
  state.rows.forEach((row) => {
    row.native_transaction_id = nextId;
  });
  await page.getByRole("textbox", { name: "Amazon transaction ID", exact: true }).fill(nextId);
  await page.getByRole("button", { name: "Find transaction", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("1.00");
  expect(state.requests.at(-1)).toMatchObject({ p_native_transaction_id: nextId, p_offset: 0 });
  await page.reload();
  await expect(table.locator("tbody tr").first()).toContainText("1.00");
});

test("source recovery does not steal focus after the user moves to Close", async ({ page }) => {
  const { state, opener } = await openSourceLookup(page);
  state.status = 403;
  await opener.click();
  const drawer = sourceDetail(page);
  await expect(drawer.getByRole("alert")).toBeVisible();
  const response = deferred();
  state.wait = response.promise;
  state.status = 200;
  try {
    await drawer.getByRole("button", { name: "Retry source record", exact: true }).press("Enter");
    const close = drawer.getByRole("button", { name: "Close row details", exact: true });
    await close.focus();
    response.resolve();
    await expect(drawer.getByRole("heading", { name: "RETAINED-00", exact: true })).toBeVisible();
    await expect(close).toBeFocused();
  } finally {
    response.resolve();
  }
});

test("a source record removed during refresh keeps keyboard navigation in its drawer", async ({
  page,
}) => {
  await page.clock.install();
  const { fixture, state, opener } = await openSourceLookup(page);
  await opener.click();
  const drawer = sourceDetail(page);
  await expect(drawer.getByRole("heading", { name: "RETAINED-00", exact: true })).toBeVisible();
  state.status = 503;
  fixture.revisions.finances = "removed-source";
  await page.clock.fastForward(60_000);
  await expect(drawer.getByRole("alert")).toBeVisible();
  state.status = 200;
  state.missing = true;
  await drawer.getByRole("button", { name: "Retry source record", exact: true }).press("Enter");
  await expect(drawer.getByRole("status")).toContainText(
    "This exact source row/version is no longer available.",
  );
  await expect(
    drawer.getByRole("button", { name: "Close row details", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    drawer.getByRole("button", { name: "Close row details", exact: true }),
  ).toBeFocused();
});
