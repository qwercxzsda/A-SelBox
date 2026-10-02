import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import {
  setup,
  editor,
  review,
  openEditor,
  openReview,
  stageRate,
  item,
  period,
  version,
} from "./sku-configuration-fixtures.mjs";

test("F5 retains transaction ordering, pagination and the selected row using fresh reads", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await page.getByRole("button", { name: "Oldest first", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await rowWithSku(page, "ALPHA-026").click();
  const reads = fixture.requests.length;
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Selected row details" })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "ALPHA-026", exact: true }),
  ).toBeVisible();
  expect(fixture.requests.length).toBeGreaterThan(reads);
  expect(fixture.requests.at(-1).params.get("offset")).toBe("25");
  expect(fixture.requests.at(-1).params.get("order")).toContain("activity_date.asc");
});

test("F5 restores the fee tab, expanded SKU, unfinished editor and review reason", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByLabel("Search SKUs", { exact: true }).fill("S1");
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.123456");
  await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Current fees", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.123456");
  await expect(editor(page).getByLabel("Fee rate 2 (%)", { exact: true })).toHaveValue("");
  await editor(page).getByRole("button", { name: "Remove period 2", exact: true }).click();
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue("S1");
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for S1", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await openReview(page);
  await review(page).getByLabel("Reason for changes (optional)").fill("Preserve my explanation");
  await page.reload();
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByLabel("Reason for changes (optional)")).toHaveValue(
    "Preserve my explanation",
  );
  await expect(review(page).getByRole("cell", { name: "6.123456%", exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("F5 during a fee save never repeats it and preserves the original optimistic version", async ({
  page,
}) => {
  const fixture = await setup(page);
  await stageRate(page, "6");
  await openReview(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeConfigurationSave = async () => {
    started.resolve();
    await release.promise;
  };
  await review(page).getByRole("button", { name: "Save all changes", exact: true }).click();
  await started.promise;
  await page.reload();
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByRole("alert")).toContainText("before the save was confirmed");
  await expect(
    review(page).getByRole("button", { name: "Save all changes", exact: true }),
  ).toBeDisabled();
  expect(fixture.configurationSaves).toHaveLength(1);
  release.resolve();
  await review(page).getByRole("button", { name: "Back to editing", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "before the save was confirmed" }),
  ).toBeVisible();
  fixture.skuConfigurationItems[0] = item("S1", {
    terms_version_id: version(21),
    periods: [period("9")],
  });
  await page.getByRole("button", { name: "Refresh saved settings", exact: true }).click();
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6");
  await expect(
    editor(page).getByRole("button", { name: "Load latest saved settings", exact: true }),
  ).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(1);
});

test("sign out removes saved tab and fee editing state for the next session", async ({ page }) => {
  const fixture = await setup(page);
  await stageRate(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByText("No unsaved changes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("failed browser persistence warns above the editor and keeps unfinished edits usable", async ({
  page,
}) => {
  const fixture = await setup(page);
  await openEditor(page);
  await expect(page.getByText("Reload protection unavailable", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("aselbox.workspace."))
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.123456");
  const warning = page.getByRole("alert").filter({ hasText: "Reload protection unavailable" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Reloading may lose unsaved edits");
  expect(
    await warning.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(element.ownerDocument.elementFromPoint(box.x + 12, box.y + 12));
    }),
  ).toBe(true);
  await warning.getByRole("button", { name: "Dismiss reload warning", exact: true }).click();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.123456");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  await expect(review(page).getByRole("cell", { name: "6.123456%", exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
});
