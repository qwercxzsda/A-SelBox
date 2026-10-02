import { expect, test } from "@playwright/test";
import { kioskRow, liveRow, settlementRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyDates, openColumn, sortBy } from "./table-actions.mjs";

async function choose(page, label, choices) {
  const menu = await openColumn(page, label);
  for (const choice of choices) {
    await menu.getByRole("checkbox", { name: choice, exact: true }).check();
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

for (const role of ["operator", "company_member"]) {
  test(`${role} can see and remove table refinements and recover without losing ordering`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.liveRows = Array.from({ length: 40 }, (_, index) => liveRow("ALPHA", index + 1));
    fixture.skuOptions = fixture.liveRows.map((row) => row.sku);
    fixture.assignments = skuAssignments(fixture.skuOptions);
    await signIn(page);
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await sortBy(page, "Date", "Oldest first");
    await applyDates(page, "2026-09-01", "2026-09-30");
    await choose(page, "SKU", ["ALPHA-001", "ALPHA-002"]);
    await choose(page, "Source", ["Settlements"]);
    const filters = page.getByLabel("Applied table filters", { exact: true });
    await expect(filters).toContainText("3 filters applied");
    await expect(filters).toContainText("SKU: 2 selected");
    await expect(filters).toContainText("Source: Settlements");
    await expect(filters).toContainText("Date: 2026-09-01 – 2026-09-30");
    await expect(
      filters.getByRole("button", { name: /^Clear sku filter: ALPHA-001, ALPHA-002$/ }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${role}-filters-1440.png`),
      animations: "disabled",
    });

    await filters.getByRole("button", { name: /^Clear sku filter:/ }).click();
    await expect(filters).toContainText("2 filters applied");
    await expect(
      page.getByRole("table", { name: "Financial records" }).locator("tbody tr"),
    ).toHaveCount(40);
    await expect(filters).toContainText("Source: Settlements");
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await page.getByLabel("Search", { exact: true }).fill("NO-MATCH");
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset search and filters", exact: true }).click();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
    await expect(filters).toHaveCount(0);
    await expect(
      page.getByRole("table", { name: "Financial records" }).locator("tbody tr"),
    ).toHaveCount(40);
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
}

test("wide financial columns remain reachable at the top without reloading rows", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.liveRows = Array.from({ length: 100 }, (_, index) => liveRow("ALPHA", index + 1));
  await signIn(page);
  await page.getByLabel("Rows", { exact: true }).selectOption("100");
  const region = page.getByRole("region", { name: "Financial table", exact: true });
  await expect(region.locator("tbody tr")).toHaveCount(100);
  const right = page.getByRole("button", { name: "Scroll table right", exact: true });
  const left = page.getByRole("button", { name: "Scroll table left", exact: true });
  await expect(left).toBeDisabled();
  await expect(right).toBeInViewport();
  const reads = fixture.requests.length;
  await right.click();
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(right).toBeDisabled();
  await expect(left).toBeEnabled();
  await expect(
    region.getByRole("columnheader", { name: "Company amount", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("financial-columns-right-1440.png"),
    animations: "disabled",
  });
  await left.click();
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0);
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(fixture.requests).toHaveLength(reads);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(right).toHaveCount(0);
});

for (const width of [1440, 834, 390]) {
  test(`source records keep zero amounts and processing metadata accessible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    fixture.settlementRows = [settlementRow(1, "0")];
    fixture.kioskRows = [kioskRow(1, "0")];
    await signIn(page);
    for (const tab of ["Settlements", "Data Kiosk"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const table = page.getByRole("table", { name: "Financial records", exact: true });
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(
        table.getByRole("columnheader", { name: "Processing version", exact: true }),
      ).toHaveCount(0);
      await expect(table.getByRole("cell", { name: "0 USD", exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`${tab}-${width}.png`),
        animations: "disabled",
      });
      await table.locator("tbody tr").first().focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
      await drawer.getByRole("button", { name: "Additional details", exact: true }).click();
      const metadata = drawer.getByRole("table", {
        name: "Additional record details",
        exact: true,
      });
      await expect(
        metadata.getByRole("cell", { name: "Processing version", exact: true }),
      ).toBeVisible();
      await expect(metadata.getByRole("cell", { name: "v0", exact: true })).toBeVisible();
      await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
    }
  });
}
