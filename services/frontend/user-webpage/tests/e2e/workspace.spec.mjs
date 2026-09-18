import { expect, test } from "@playwright/test";
import {
  captureResponsiveReview,
  deferred,
  mockSupabase,
  rowWithSku,
  signIn,
} from "./fixtures.mjs";

for (const activation of ["click", "Enter", "Space"]) {
  test(`${activation} inspects the chosen nonfirst row and restores focus after closing`, async ({
    page,
  }, testInfo) => {
    await mockSupabase(page);
    await signIn(page);
    const row = rowWithSku(page, "ALPHA-002");
    await expect(row).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (activation === "click") await captureResponsiveReview(page, testInfo, "workspace");
    if (activation === "click") await row.click();
    else {
      await row.focus();
      await row.press(activation);
    }

    const details = page.getByRole("dialog", { name: "Selected row details" });
    await expect(details).toBeVisible();
    await expect(details.getByRole("heading", { name: "ALPHA-002", exact: true })).toBeVisible();
    await expect(details.getByText("2.123456789012345678 USD", { exact: true })).toBeVisible();
    if (activation === "click") await captureResponsiveReview(page, testInfo, "drawer", false);
    await expect
      .poll(() =>
        details.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
      )
      .toBe(true);
    if (activation === "Enter") await page.keyboard.press("Escape");
    else await details.getByRole("button", { name: "Close row details" }).click();
    await expect(details).toHaveCount(0);
    await expect(row).toBeFocused();
  });
}

test("pagination, sorting, and literal search make server requests and reset the page", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  expect(fixture.requests.at(-1).params.get("offset")).toBe("25");

  await page.getByRole("button", { name: "Date", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  expect(fixture.requests.at(-1).params.get("order")).toBe(
    "activity_date.asc.nullslast,source.asc,source_row_id.asc",
  );
  expect(fixture.requests.at(-1).params.get("offset")).toBe("0");

  await page.getByLabel("Rows", { exact: true }).selectOption("50");
  await expect(rowWithSku(page, "ALPHA-030")).toBeVisible();
  expect(fixture.requests.at(-1).params.get("limit")).toBe("50");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();

  await page.getByLabel("Search", { exact: true }).fill("SKU.(special)");
  await expect(page.getByRole("row")).toHaveCount(2);
  expect(fixture.requests.at(-1).params.get("or")).toContain(
    String.raw`sku.imatch."SKU\\.\\(special\\)"`,
  );
  expect(fixture.requests.at(-1).params.get("offset")).toBe("0");
});

test("selecting table text leaves the details drawer closed", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);
  const cell = page.getByRole("cell", { name: "ALPHA-002", exact: true });
  await expect(cell).toBeVisible();
  const bounds = await cell.boundingBox();
  await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + bounds.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => cell.evaluate((element) => element.ownerDocument.defaultView.getSelection()?.type))
    .toBe("Range");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("automatic refresh detects a company reassignment using the existing session", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  fixture.companyIds["member-a"] = "company-reassigned";
  fixture.prefixes["member-a"] = "REASSIGNED";
  const started = deferred();
  const release = deferred();
  fixture.beforeDataset = async () => {
    started.resolve();
    await release.promise;
  };
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  await page.clock.fastForward(60_000);
  await started.promise;
  await expect(rowWithSku(page, "ALPHA-001")).toHaveCount(0);
  release.resolve();
  await expect(rowWithSku(page, "REASSIGNED-001")).toBeVisible();
  expect(fixture.authRequests).toBe(1);
});

test("automatic refresh clamps a removed last page after an HTTP 416 response", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  fixture.totalCount = 5;
  await page.clock.fastForward(60_000);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fixture.requests.at(-1).params.get("offset")).toBe("0");
});

test("a delayed earlier search cannot replace newer search results", async ({ page }) => {
  const fixture = await mockSupabase(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeDataset = async ({ params }) => {
    if (params.get("or")?.includes("STALE")) {
      started.resolve();
      await release.promise;
    }
  };
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const olderRequestSettled = new Promise((resolve) => {
    const onSettled = (request) => {
      if (new URL(request.url()).searchParams.get("or")?.includes("STALE")) resolve();
    };
    page.on("requestfinished", onSettled);
    page.on("requestfailed", onSettled);
  });
  await page.getByLabel("Search", { exact: true }).fill("STALE");
  await started.promise;
  await page.getByLabel("Search", { exact: true }).fill("FRESH");
  await expect(rowWithSku(page, "FRESH-001")).toBeVisible();
  release.resolve();
  await olderRequestSettled;
  await page.getByRole("table").evaluate(
    (element) =>
      new Promise((resolve) => {
        element.ownerDocument.defaultView.requestAnimationFrame(() => resolve());
      }),
  );
  await expect(rowWithSku(page, "STALE-001")).toHaveCount(0);
  await expect(rowWithSku(page, "FRESH-001")).toBeVisible();
});

test("sign out clears rows and details for another user and the same user's next session", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await rowWithSku(page, "ALPHA-002").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("ALPHA-002", { exact: true })).toHaveCount(0);

  await signIn(page, "member-b");
  await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
  await expect(page.getByText("ALPHA-001", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();

  fixture.prefixes["member-a"] = "REASSIGNED";
  const pending = deferred();
  fixture.beforeDataset = async ({ user }) => {
    if (user === "member-a") await pending.promise;
  };
  await signIn(page);
  await expect(page.getByText("ALPHA-001", { exact: true })).toHaveCount(0);
  await expect(page.getByText("BRAVO-001", { exact: true })).toHaveCount(0);
  pending.resolve();
  await expect(rowWithSku(page, "REASSIGNED-001")).toBeVisible();
});

for (const status of [401, 403]) {
  test(`HTTP ${status} is shown without immediate automatic retries and Retry recovers`, async ({
    page,
  }) => {
    await page.clock.install();
    const fixture = await mockSupabase(page);
    fixture.status = status;
    await signIn(page);
    await expect(page.getByRole("alert")).toContainText(`HTTP ${status}`);
    const deniedRequests = fixture.requests.length;
    await page.clock.runFor(15_000);
    expect(fixture.requests).toHaveLength(deniedRequests);
    // StrictMode can cancel its initial mount's request; only later attempts are retries.
    expect(deniedRequests).toBeGreaterThan(0);
    fixture.status = 200;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
