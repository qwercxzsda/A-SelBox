import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { recordId, sourceRoutes, versionId } from "./financial-source-fixtures.mjs";

for (const kind of ["source", "snapshot"]) {
  test(`monthly review exposes only its active ${kind} drawer to assistive technology`, async ({
    page,
    expectAccessible,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFinancialReview(page, (fixture) => {
      fixture.financialReviewRecords.forEach((row, index) => {
        row.source_row_id = recordId(index);
        row.source_version_id = versionId;
      });
    });
    await sourceRoutes(page);
    const month = kind === "source" ? "July" : "June";
    await page.getByRole("button", { name: `Open review for ${month} 2026`, exact: true }).click();
    const parent = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    let opener;
    if (kind === "source") {
      await parent.getByRole("button", { name: "Source records", exact: true }).click();
      await parent
        .getByRole("combobox", { name: "Record source", exact: true })
        .selectOption("FINANCES");
      opener = parent
        .getByRole("table", { name: "Source records", exact: true })
        .locator("tbody tr.inspectable-row")
        .first();
    } else {
      await parent.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
      opener = parent
        .getByRole("region", { name: "Saved report snapshots", exact: true })
        .getByRole("table", { name: "Financial records", exact: true })
        .locator("tbody tr[tabindex='0']")
        .first();
    }
    await opener.click();
    const child = page.getByRole("dialog", {
      name: kind === "source" ? "Finances record details" : "Saved report source details",
      exact: true,
    });
    await expect(child).toBeVisible();
    if (kind === "source")
      await expect(child.getByRole("heading", { name: /^RETAINED-/ })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`nested-${kind}.png`),
      animations: "disabled",
    });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expectAccessible(`monthly-${kind}-drawer`);
    await page.keyboard.press("Escape");
    await expect(child).toBeHidden();
    await expect(parent).toBeVisible();
    await expect(opener).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
}
