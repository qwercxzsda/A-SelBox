import { expect, test } from "@playwright/test";
import { assignmentId, feeRow, skuAssignment } from "./api-fixtures.mjs";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";

const SKU = "GROUP 001 / 한글 %";
const groupButton = (page) =>
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
    ({ completed, params }) => completed && params.get("seller_sku_id") === `eq.${assignment}`,
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

async function groupedFeeFixture(page, role = "company_member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  const secondCompany = role === "operator" ? "company-member-b" : "company-member-a";
  fixture.assignments = Array.from({ length: 26 }, (_, index) => ({
    ...skuAssignment(index + 1),
    sku: index < 2 ? SKU : `GROUP-${String(index + 1).padStart(3, "0")}`,
    seller_namespace: index === 0 ? "seed-real-seller-a" : "seed-real-seller-b",
    company_id: index === 0 ? "company-member-a" : secondCompany,
  }));
  fixture.feePageCap = 2;
  fixture.feeRows = [
    ...["5.123456", "4.8", "0"].map((rate, index) => ({
      ...feeRow(index, assignmentId(1)),
      fee_rate_percent: rate,
      marketplace_name: ["Amazon.com", "Amazon.co.uk", "Amazon.co.jp"][index],
    })),
    ...["5.123456", "7.25", "4.8"].map((rate, index) => ({
      ...feeRow(index, assignmentId(2)),
      company_id: secondCompany,
      terms_version_id: "terms-2",
      fee_rate_percent: rate,
      marketplace_name: ["Amazon.com", "Amazon.com", "Amazon.co.uk"][index],
    })),
  ];
  return fixture;
}

for (const role of ["company_member", "operator"]) {
  test(`${role} sees one exact-SKU fee group with all assignments and no seller identifiers`, async ({
    page,
  }, testInfo) => {
    const mobile = role === "company_member";
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 1000 });
    const fixture = await groupedFeeFixture(page, role);
    const secondStarted = deferred();
    const releaseSecond = deferred();
    fixture.beforeFees = async ({ params }) => {
      if (params.get("seller_sku_id") === `eq.${assignmentId(2)}` && params.get("offset") === "0") {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
    };
    await signIn(page);
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    const group = groupButton(page);
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
      /1[-–]25 of 25 SKUs/,
    );
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await expect(page.getByText(/Seller:|seed-real-seller/)).toHaveCount(0);
    expect(fixture.feeRequests).toHaveLength(0);
    if (role === "operator") {
      await expect(group).toContainText("Company A");
      await expect(group).toContainText("Company B");
      await page.getByLabel("Search SKUs", { exact: true }).fill("Company A");
      await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
        /1[-–]1 of 1 SKUs/,
      );
    } else {
      await expect(group).not.toContainText("Company A");
      await expect(page.getByText("Company A", { exact: true })).toHaveCount(1);
      await page.getByLabel("Search SKUs", { exact: true }).fill(SKU);
    }
    await group.click();
    await secondStarted.promise;
    const panelId = await group.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(panelId).not.toMatch(/\s/);
    await expect
      .poll(() =>
        group.evaluate((element) => {
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
      .toEqual(["0", "2"]);
    await expect(page.getByText("Loading marketplace fees…", { exact: true })).toBeVisible();
    await expect(feeTable(page)).toHaveCount(0);
    releaseSecond.resolve();
    const table = feeTable(page);
    await expect(table.getByRole("row")).toHaveCount(7);
    await expect(table.getByRole("cell", { name: "5.123456%", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "4.8%", exact: true })).toHaveCount(2);
    await expect(table.getByRole("cell", { name: "0%", exact: true })).toHaveCount(1);
    await expect(table.getByRole("cell", { name: "7.25%", exact: true })).toHaveCount(1);
    await expect(table.getByRole("columnheader", { name: "Company", exact: true })).toHaveCount(
      role === "operator" ? 1 : 0,
    );
    if (role === "operator") {
      await expect(table.getByRole("cell", { name: "Company A", exact: true })).toHaveCount(3);
      await expect(table.getByRole("cell", { name: "Company B", exact: true })).toHaveCount(3);
    }
    for (const id of [assignmentId(1), assignmentId(2)]) {
      expect(completedFeeRequests(fixture, id).map(({ params }) => params.get("offset"))).toEqual([
        "0",
        "2",
      ]);
    }
    expectOnlyCanceledExtras(fixture);
    await expectCompleteExpandedPanel(table, panelId);
    if (mobile) {
      const box = await table.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`combined-sku-fees-${mobile ? "mobile" : "desktop"}.png`),
      animations: "disabled",
      fullPage: true,
    });
    const requestsBeforeTabSwitch = fixture.feeRequests.length;
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(table.getByRole("row")).toHaveCount(7);
    await expectCompleteExpandedPanel(table, await group.getAttribute("aria-controls"));
    await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue(
      role === "operator" ? "Company A" : SKU,
    );
    expect(fixture.feeRequests).toHaveLength(requestsBeforeTabSwitch);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await page.getByLabel("Search SKUs", { exact: true }).fill("seed-real-seller-a");
    await expect(page.getByText("No SKUs match your search.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute("aria-expanded", "false");
  });
}

test("a failed assignment withholds the combined fee table until an explicit retry succeeds", async ({
  page,
}) => {
  const fixture = await groupedFeeFixture(page);
  fixture.feeStatusForRequest = ({ params }) =>
    params.get("seller_sku_id") === `eq.${assignmentId(2)}` ? 403 : 200;
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await groupButton(page).click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("HTTP 403");
  await expect(feeTable(page)).toHaveCount(0);
  await expect.poll(() => completedFeeRequests(fixture, assignmentId(2)).length).toBe(1);
  expect(completedFeeRequests(fixture, assignmentId(2))[0].status).toBe(403);
  await expect.poll(() => completedFeeRequests(fixture, assignmentId(1)).length).toBe(2);
  expectOnlyCanceledExtras(fixture);
  fixture.feeStatusForRequest = () => 200;
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(feeTable(page).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(feeTable(page).getByRole("cell", { name: "7.25%", exact: true })).toBeVisible();
});
