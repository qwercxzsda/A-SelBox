import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth } from "./table-actions.mjs";

const company = "0198b50b-701a-7000-8000-000000000001";
const report = "0198b50b-701a-7000-8000-000000000002";
const completedPolls = (fixture) =>
  fixture.revisionRequests.filter(({ completed }) => completed).length;
const reportReads = (fixture) => ({
  rows: fixture.requests.filter(({ dataset }) => dataset === "payouts").length,
  counts: fixture.countRequests.filter(({ dataset }) => dataset === "payouts").length,
});

async function checkForUpdates(page, fixture) {
  const before = completedPolls(fixture);
  await page.clock.fastForward(60_000);
  await expect.poll(() => completedPolls(fixture)).toBeGreaterThan(before);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}

for (const role of ["operator", "company_member"]) {
  test(`${role} sees background payout publications after lightweight revision checks`, async ({
    page,
  }) => {
    await page.clock.install();
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.companyIds["member-a"] = company;
    fixture.companyIds["member-b"] = company;
    fixture.companyNames[company] = "Monthly Company";
    const first = {
      id: report,
      company_id: company,
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      created_at: "2026-09-27T00:00:00Z",
      currency: "USD",
    };
    fixture.payoutRows = [first];
    await signIn(page);
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    await applyReportMonth(page, "2026-06");
    await expect(page.getByRole("cell", { name: "95 USD", exact: true })).toBeVisible();
    await expect(page.getByText("1–1 of 1 latest reports", { exact: true })).toBeVisible();
    const before = reportReads(fixture);

    await checkForUpdates(page, fixture);
    expect(reportReads(fixture)).toEqual(before);
    expect(fixture.revisionRequests.at(-1).sources).toContain("payouts");

    fixture.revisions.fees = "2";
    fixture.revisions.data_kiosk = "2";
    await checkForUpdates(page, fixture);
    expect(reportReads(fixture)).toEqual(before);
    await expect(page.getByRole("cell", { name: "95 USD", exact: true })).toBeVisible();

    // The server may combine intermediate changes before publishing a newer snapshot.
    fixture.payoutRows.push({
      ...first,
      id: "0198b50b-701a-7000-8000-000000000003",
      fee_amount: "-7",
      company_amount: "93",
      created_at: "2026-09-30T00:00:00Z",
    });
    fixture.revisions.payouts = "new-snapshot";
    await checkForUpdates(page, fixture);
    await expect(page.getByRole("cell", { name: "93 USD", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "95 USD", exact: true })).toHaveCount(0);
    await expect(page.getByText("1–1 of 1 latest reports", { exact: true })).toBeVisible();
    expect(reportReads(fixture)).toEqual({ rows: before.rows + 1, counts: before.counts + 1 });

    await checkForUpdates(page, fixture);
    expect(reportReads(fixture)).toEqual({ rows: before.rows + 1, counts: before.counts + 1 });
    expect(fixture.events.some(({ endpoint }) => endpoint.includes("generate"))).toBe(false);
    await page.getByRole("button", { name: /^Show versions for/ }).click();
    await expect(page.getByRole("cell", { name: "95 USD", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "93 USD", exact: true }).first()).toBeVisible();
    await expect(page.getByText("1–1 of 1 latest reports", { exact: true })).toBeVisible();

    fixture.payoutRows.push({
      ...first,
      id: "0198b50b-701a-7000-8000-000000000004",
      fee_amount: "-9",
      company_amount: "91",
      created_at: "2026-10-01T00:00:00Z",
    });
    fixture.revisions.payouts = "next-snapshot";
    await checkForUpdates(page, fixture);
    const history = page.getByRole("region", { name: /^Report versions for/ });
    await expect(history).toBeVisible();
    await expect(history.getByRole("cell", { name: "91 USD", exact: true })).toBeVisible();
    await expect(history.getByRole("cell", { name: "93 USD", exact: true })).toBeVisible();
    await expect(history.locator('tr[data-version="latest"]')).toContainText("91 USD");
  });
}
