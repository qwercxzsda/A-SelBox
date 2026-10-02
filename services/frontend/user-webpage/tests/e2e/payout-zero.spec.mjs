import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview } from "./fixtures.mjs";
import { applyReportMonth, selectColumnOptions } from "./table-actions.mjs";

test("a saved zero report displays without a currency and remains readable during background updates", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const company = "0198b50b-701a-7000-8000-000000000001";
  fixture.roles["member-a"] = "operator";
  fixture.companyIds["member-b"] = company;
  fixture.companyNames[company] = "Monthly Company";
  fixture.payoutRows = [
    {
      id: "0198b50b-701a-7000-8000-000000000002",
      company_id: company,
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27T00:00:00Z",
      seller_namespace: null,
      currency: null,
      preprocess_version: null,
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
      component_count: "0",
      reconciliation_count: "0",
      settlement_version_count: "2",
      data_kiosk_version_count: "1",
      terms_version_count: "1",
    },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await selectColumnOptions(page, "Company", ["Monthly Company"]);
  await applyReportMonth(page, "2026-06");
  await expect(page.getByRole("cell", { name: "0", exact: true })).toHaveCount(3);
  await page.getByRole("cell", { name: "0", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Selected row details" });
  await expect(
    drawer.getByRole("region", { name: "Breakdown total" }).getByText("0", { exact: true }),
  ).toHaveCount(3);
  await drawer.getByText("Marketplace breakdown", { exact: true }).first().click();
  await expect(drawer.getByText("No saved marketplace amounts.", { exact: true })).toBeVisible();
  await expect(
    drawer.getByText("No records match this selection.", { exact: true }).first(),
  ).toBeVisible();
  await expect(drawer.getByRole("columnheader")).toHaveCount(0);
  await expect(drawer.getByText("Reconciliation", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText(/\b0 [A-Z]{3}\b/)).toHaveCount(0);
  await captureResponsiveReview(page, testInfo, "zero-payout-report");
  await page.getByRole("button", { name: "Close row details" }).click();
  const completedPolls = () => fixture.revisionRequests.filter(({ completed }) => completed).length;
  const pollsBefore = completedPolls();
  fixture.revisions.settlement = "1";
  fixture.revisions.data_kiosk = "1";
  fixture.revisions.fees = "1";
  await page.clock.fastForward(60_000);
  await expect.poll(completedPolls).toBeGreaterThan(pollsBefore);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  expect(fixture.events.some(({ endpoint }) => endpoint.includes("generate"))).toBe(false);
  expect(fixture.payoutRows).toHaveLength(1);
  await expect(page.getByRole("cell", { name: "0", exact: true })).toHaveCount(3);
});
