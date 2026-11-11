import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth } from "./table-actions.mjs";
import { openReviewReadiness, readiness } from "./payout-readiness-fixtures.mjs";

const COMPANY = "0198b50b-701a-7000-8000-000000000001";
function setup(fixture, administrator) {
  fixture.roles["member-a"] = administrator ? "administrator" : "member";
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = "Payout Company";
  fixture.payoutReadinessRows = [
    {
      company_id: COMPANY,
      company_name: "Payout Company",
      month: "2026-04-01",
      status: "BLOCKED",
      reason: "SETUP_REQUIRED",
      has_report: "false",
      last_success_at: null,
      next_attempt_at: "2026-10-18T18:00:00Z",
    },
  ];
  fixture.payoutSetupBlockers = [
    {
      company_id: COMPANY,
      month: "2026-04-01",
      sku: "UNASSIGNED-SKU",
      reason: "MISSING_OWNERSHIP",
      marketplace_name: "Amazon.com",
      first_date: "2026-04-03",
      last_date: "2026-04-20",
      component_count: "244",
    },
  ];
}

test("administrator can inspect blocked payout setup within Financial review snapshots", async ({
  page,
}) => {
  const fixture = await openReviewReadiness(page, (state) => setup(state, true));
  await expect(readiness(page)).toContainText("SKU ownership or fee coverage needs setup");
  expect(
    fixture.payoutReadinessRequests.some(({ endpoint }) =>
      endpoint.endsWith("payout_setup_blockers"),
    ),
  ).toBe(false);
  await readiness(page)
    .getByRole("button", { name: "View setup requirements", exact: true })
    .click();
  const setupTable = page.getByRole("table", { name: "Payout setup requirements", exact: true });
  await expect(setupTable).toContainText("Assign company ownership");
  await expect(setupTable).toContainText("2026-04-03");
  await expect(setupTable).toContainText("UNASSIGNED-SKU");
  await expect(setupTable.getByRole("button", { name: "UNASSIGNED-SKU", exact: true })).toHaveCount(
    0,
  );
  expect(fixture.events.some(({ endpoint }) => endpoint.includes("generate"))).toBe(false);
});

for (const administrator of [false, true]) {
  test(`${administrator ? "administrator" : "member"} payout browsing has no readiness or policy requests`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    setup(fixture, administrator);
    await signIn(page);
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    await applyReportMonth(page, "2026-04");
    await expect(page.getByText("No matching reports", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /payout readiness/ })).toHaveCount(0);
    await expect(page.getByText("UNASSIGNED-SKU", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Check readiness above", { exact: false })).toHaveCount(0);
    expect(fixture.payoutReadinessRequests ?? []).toHaveLength(0);
    expect(fixture.events.some(({ endpoint }) => endpoint.endsWith("payout_report_policy"))).toBe(
      false,
    );
  });
}

test("readiness uses lightweight revision checks and changes automatically after completion", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openReviewReadiness(page, (state) => setup(state, true));
  const requests = () =>
    fixture.payoutReadinessRequests.filter(({ params }) => params.get("p_month") === "2026-04-01")
      .length;
  const completedChecks = () =>
    fixture.revisionRequests.filter(({ completed }) => completed).length;
  async function checkForUpdates() {
    const before = completedChecks();
    await page.clock.fastForward(60_000);
    // Updating can still be hidden while the revision request is in flight.
    // Settle this poll before advancing to another tick or changing its fixtures.
    await expect.poll(completedChecks).toBeGreaterThan(before);
    await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  }
  const original = requests();
  await checkForUpdates();
  expect(requests()).toBe(original);
  fixture.payoutReadinessRows[0] = {
    ...fixture.payoutReadinessRows[0],
    status: "COMPLETE",
    reason: null,
    has_report: "true",
    next_attempt_at: null,
  };
  fixture.revisions.payouts = "complete";
  await checkForUpdates();
  await expect(readiness(page).getByText("Complete", { exact: true })).toBeVisible();
  await expect(readiness(page).getByText("Blocked", { exact: true })).toHaveCount(0);
  expect(requests()).toBe(original + 1);
});
