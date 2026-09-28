import { expect, test } from "@playwright/test";
import { assignmentId, feeRow, skuAssignment } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";

const SKU = "GROUP 001 / SAMPLE";
const skuButton = (page) =>
  page.getByRole("button", {
    name: `Show marketplace fees for ${SKU}`,
    exact: true,
  });
const feeTable = (page) =>
  page.getByRole("table", {
    name: `Marketplace fees for ${SKU}`,
    exact: true,
  });

function completedFeeRequests(fixture, assignment) {
  return fixture.feeRequests.filter(
    ({ completed, params }) => completed && params.get("sku_id") === `eq.${assignment}`,
  );
}

function expectOnlyCanceledExtras(fixture) {
  for (const entry of fixture.feeRequests.filter(({ completed }) => !completed)) {
    expect(entry.failure).toBe("net::ERR_ABORTED");
  }
}

async function expectCompleteExpandedPanel(table, panelId) {
  await expect
    .poll(
      () =>
        table.evaluate((element, id) => {
          const panel = element.ownerDocument.getElementById(id);
          const lastRow = element.querySelector("tbody tr:last-child");
          if (!panel || !lastRow) return { containsLastRow: false, clipsLastRow: true };
          const rowBounds = lastRow.getBoundingClientRect();
          const panelBounds = panel.getBoundingClientRect();
          let clipsLastRow = false;
          for (let ancestor = lastRow.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = element.ownerDocument.defaultView.getComputedStyle(ancestor);
            if (!["hidden", "clip"].includes(style.overflowY)) continue;
            const bounds = ancestor.getBoundingClientRect();
            if (rowBounds.top < bounds.top - 1 || rowBounds.bottom > bounds.bottom + 1)
              clipsLastRow = true;
          }
          return {
            containsLastRow:
              rowBounds.top >= panelBounds.top - 1 && rowBounds.bottom <= panelBounds.bottom + 1,
            clipsLastRow,
            panelBottom: panelBounds.bottom,
            lastRowBottom: rowBounds.bottom,
          };
        }, panelId),
      { message: "The expanded fee panel must contain its complete last row without clipping" },
    )
    .toMatchObject({ containsLastRow: true, clipsLastRow: false });
  const lastRow = table.getByRole("row").last();
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport();
}

async function feeFixture(page, role = "company_member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  const secondCompany = role === "operator" ? "company-member-b" : "company-member-a";
  fixture.assignments = Array.from({ length: 26 }, (_, index) => ({
    ...skuAssignment(index + 1),
    sku: index === 0 ? SKU : `GROUP-${String(index + 1).padStart(3, "0")}`,
    company_id: index === 0 ? "company-member-a" : secondCompany,
  }));
  fixture.feePageCap = 2;
  fixture.feeRows = ["5.123456", "4.8", "0", "5.123456", "7.25", "4.8"].map((rate, index) => ({
    ...feeRow(index, assignmentId(1)),
    fee_rate_percent: rate,
    marketplace_name: ["Amazon.com", "Amazon.co.uk", "Amazon.co.jp"][index % 3],
  }));
  return fixture;
}

for (const role of ["company_member", "operator"]) {
  test(`${role} loads one SKU's complete marketplace fees without namespace-specific requests`, async ({
    page,
  }, testInfo) => {
    const mobile = role === "company_member";
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 1000 });
    const fixture = await feeFixture(page, role);
    const secondStarted = deferred();
    const releaseSecond = deferred();
    fixture.beforeFees = async ({ params }) => {
      if (params.get("offset") === "2") {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
    };
    await signIn(page);
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    const sku = skuButton(page);
    await expect(sku).toHaveCount(1);
    await expect(sku).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
      /1[-–]25 of 26 SKUs/,
    );
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await expect(page.getByText(/Seller:|namespace/i)).toHaveCount(0);
    expect(fixture.feeRequests).toHaveLength(0);
    if (role === "operator") {
      await expect(sku).toContainText("Company A");
      await page.getByLabel("Search SKUs", { exact: true }).fill("Company A");
      await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
        /1[-–]1 of 1 SKUs/,
      );
    } else {
      await expect(sku).not.toContainText("Company A");
      await expect(page.getByText("Company A", { exact: true })).toHaveCount(1);
      await page.getByLabel("Search SKUs", { exact: true }).fill(SKU);
    }
    await sku.click();
    await secondStarted.promise;
    const panelId = await sku.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(panelId).not.toMatch(/\s/);
    await expect
      .poll(() =>
        sku.evaluate((element) => {
          const controlledId = element.getAttribute("aria-controls");
          return (
            controlledId !== null && element.ownerDocument.getElementById(controlledId) !== null
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        completedFeeRequests(fixture, assignmentId(1)).map(({ params }) => params.get("offset")),
      )
      .toEqual(["0"]);
    await expect(page.getByText("Loading marketplace fees…", { exact: true })).toBeVisible();
    await expect(feeTable(page)).toHaveCount(0);
    releaseSecond.resolve();
    const table = feeTable(page);
    await expect(table.getByRole("row")).toHaveCount(7);
    await expect(table.getByRole("cell", { name: "5.123456%", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "4.8%", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "0%", exact: true })).toHaveCount(1);
    await expect(table.getByRole("cell", { name: "7.25%", exact: true })).toHaveCount(1);
    await expect(table.getByRole("columnheader", { name: "Company", exact: true })).toHaveCount(0);
    expect(
      completedFeeRequests(fixture, assignmentId(1)).map(({ params }) => params.get("offset")),
    ).toEqual(["0", "2", "4"]);
    expectOnlyCanceledExtras(fixture);
    await expectCompleteExpandedPanel(table, panelId);
    if (mobile) {
      const box = await table.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await sku.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`sku-fees-${mobile ? "mobile" : "desktop"}.png`),
      animations: "disabled",
      fullPage: true,
    });
    const requestsBeforeTabSwitch = fixture.feeRequests.length;
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(sku).toHaveAttribute("aria-expanded", "true");
    await expect(table.getByRole("row")).toHaveCount(7);
    await expectCompleteExpandedPanel(table, await sku.getAttribute("aria-controls"));
    await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue(
      role === "operator" ? "Company A" : SKU,
    );
    expect(fixture.feeRequests).toHaveLength(requestsBeforeTabSwitch);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await expect(sku).toHaveAttribute("aria-expanded", "false");
    await page.getByLabel("Search SKUs", { exact: true }).fill("missing-sku");
    await expect(page.getByText("No SKUs match your search.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
    await expect(sku).toBeVisible();
    await expect(sku).toHaveAttribute("aria-expanded", "false");
  });
}

test("a failed fee page withholds incomplete rates until an explicit retry succeeds", async ({
  page,
}) => {
  const fixture = await feeFixture(page);
  fixture.feeStatusForRequest = ({ params }) => (params.get("offset") === "2" ? 403 : 200);
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await skuButton(page).click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("HTTP 403");
  await expect(feeTable(page)).toHaveCount(0);
  await expect.poll(() => completedFeeRequests(fixture, assignmentId(1)).length).toBe(2);
  expect(completedFeeRequests(fixture, assignmentId(1))[1].status).toBe(403);
  expectOnlyCanceledExtras(fixture);
  fixture.feeStatusForRequest = () => 200;
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(feeTable(page).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(feeTable(page).getByRole("cell", { name: "7.25%", exact: true })).toBeVisible();
});
