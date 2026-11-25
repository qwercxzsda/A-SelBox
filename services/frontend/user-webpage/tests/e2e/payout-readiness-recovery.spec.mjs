import { expect, test } from "@playwright/test";
import { openReviewReadiness, readiness } from "./payout-readiness-fixtures.mjs";
import { reviewDrawer, reviewMeasure } from "./financial-review-fixtures.mjs";

const companyId = (index) => `0198b50b-701a-7000-8000-${String(index + 1).padStart(12, "0")}`;

async function openReadiness(page, companyCount = 1, requirementCount = 26) {
  const fixture = await openReviewReadiness(page, (fixture) => {
    fixture.payoutReadinessRows = Array.from({ length: companyCount }, (_, index) => ({
      company_id: companyId(index),
      company_name: `Company ${String(index + 1).padStart(2, "0")}`,
      month: "2026-04-01",
      eligible: "t",
      mature: "t",
      refresh_pending: "t",
      failure_count: "1",
      failure_reason: "SETUP_REQUIRED",
      has_activity: "f",
      has_report: "f",
      last_success_at: null,
      next_attempt_at: null,
    }));
    fixture.payoutSetupBlockers = Array.from({ length: requirementCount }, (_, index) => ({
      company_id: companyId(0),
      month: "2026-04-01",
      sku: `BLOCKED-${String(index).padStart(2, "0")}`,
      reason: "MISSING_FEE",
      marketplace_name: "Amazon.com",
      first_date: "2026-04-01",
      last_date: "2026-04-30",
      component_count: "1",
    }));
  });
  await expect(readiness(page).getByText("Company 01", { exact: true })).toBeVisible();
  return fixture;
}

test("a failed later readiness page keeps a route back to cached companies", async ({ page }) => {
  const fixture = await openReadiness(page, 26);
  fixture.payoutReadinessStatus = 503;
  await readiness(page).getByRole("button", { name: "Next companies", exact: true }).click();
  const alert = readiness(page).getByRole("alert");
  await expect(alert).toContainText("Could not load payout readiness");
  await expect(alert).toContainText("The server returned HTTP 503. Retrying automatically.");
  await expect(alert.getByRole("button")).toHaveCount(0);
  const previous = readiness(page).getByRole("button", { name: "Previous companies", exact: true });
  await expect(previous).toBeVisible();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(readiness(page).getByText("Company 01", { exact: true })).toBeVisible();
  await expect(readiness(page).getByText("Company 25", { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
});

test("a failed later setup page keeps a route back to cached requirements", async ({ page }) => {
  const fixture = await openReadiness(page);
  await readiness(page)
    .getByRole("button", { name: "Show setup requirements for Company 01", exact: true })
    .click();
  const table = readiness(page).getByRole("table", {
    name: "Payout setup requirements",
    exact: true,
  });
  await expect(table.locator("tbody tr")).toHaveCount(25);
  fixture.payoutReadinessStatus = 503;
  await readiness(page).getByRole("button", { name: "Next requirements", exact: true }).click();
  await expect(readiness(page).getByRole("alert")).toContainText(
    "Could not load payout setup requirements",
  );
  const previous = readiness(page).getByRole("button", {
    name: "Previous requirements",
    exact: true,
  });
  await expect(previous).toBeVisible();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(table).toContainText("BLOCKED-00");
});

test("cached readiness pages return to the first company with keyboard context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openReadiness(page, 55);
  const region = readiness(page);
  await region.getByRole("button", { name: "Next companies", exact: true }).click();
  await expect(region.getByText("Company 26", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Previous companies", exact: true }).click();
  await expect(region.getByText("Company 01", { exact: true })).toBeInViewport();
  await expect(region).toBeFocused();
});

test("cached setup pages return to the first requirement with keyboard context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openReadiness(page, 1, 55);
  await readiness(page)
    .getByRole("button", { name: "Show setup requirements for Company 01", exact: true })
    .click();
  const table = readiness(page).getByRole("table", {
    name: "Payout setup requirements",
    exact: true,
  });
  await readiness(page).getByRole("button", { name: "Next requirements", exact: true }).click();
  await expect(table).toContainText("BLOCKED-25");
  await readiness(page).getByRole("button", { name: "Previous requirements", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toBeInViewport();
  await expect(
    readiness(page).getByRole("region", { name: "Payout setup requirements", exact: true }),
  ).toBeFocused();
});

test("another month starts its readiness companies on page 1, also one seen before", async ({
  page,
}) => {
  const fixture = await openReviewReadiness(page, (fixture) => {
    fixture.reviewMonths.push(
      reviewMeasure("2026-05", "FINANCES", "-10", "-1", null, 2),
      reviewMeasure("2026-05", "COMPANY", "-10", "-1", null, 2),
    );
    fixture.payoutReadinessRows = ["2026-04-01", "2026-05-01"].flatMap((month) =>
      Array.from({ length: 26 }, (_, index) => ({
        company_id: companyId(index),
        company_name: `Company ${String(index + 1).padStart(2, "0")}`,
        month,
        eligible: "t",
        mature: "t",
        refresh_pending: "f",
        failure_count: "0",
        failure_reason: null,
        has_activity: "t",
        has_report: "t",
        last_success_at: null,
        next_attempt_at: null,
      })),
    );
  });
  const lastOffset = () => fixture.payoutReadinessRequests.at(-1).params.get("p_offset") ?? "0";
  await readiness(page).getByRole("button", { name: "Next companies", exact: true }).click();
  await expect(readiness(page).getByText("Company 26", { exact: true })).toBeVisible();
  await reviewDrawer(page, "April 2026")
    .getByRole("button", { name: "Next month", exact: true })
    .click();
  const may = page.getByRole("region", { name: "May 2026 payout readiness", exact: true });
  await expect(may.getByText("Company 01", { exact: true })).toBeVisible();
  expect(fixture.payoutReadinessRequests.at(-1).params.get("p_month")).toBe("2026-05-01");
  expect(lastOffset()).toBe("0");
  await reviewDrawer(page, "May 2026")
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(readiness(page).getByText("Company 01", { exact: true })).toBeVisible();
  await expect(readiness(page).getByText("Company 26", { exact: true })).toHaveCount(0);
  await expect(
    readiness(page).getByRole("button", { name: "Previous companies", exact: true }),
  ).toBeDisabled();
});
