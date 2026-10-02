import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth, selectColumnOptions } from "./table-actions.mjs";

const COMPANY = "0198b50b-701a-7000-8000-000000000001";
const OTHER_COMPANY = "0198b50b-701a-7000-8000-000000000002";
const COMPANY_NAME = "Monthly Company";
const scope = `${COMPANY_NAME} · June 2026 · USD`;
const historyReads = (fixture) =>
  fixture.requests.filter(({ endpoint }) => endpoint === "/rest/v1/company_payout_reports");

function report(index, overrides = {}) {
  return {
    id: `0198b50b-701a-7000-8001-${String(index).padStart(12, "0")}`,
    company_id: COMPANY,
    start_date: "2026-06-01",
    end_date: "2026-06-30",
    currency: "USD",
    created_at: "2026-09-27T00:00:00Z",
    source_amount: "100",
    fee_amount: "-5",
    company_amount: "95",
    ...overrides,
  };
}

async function setup(page, role) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds = { "member-a": COMPANY, "member-b": OTHER_COMPANY };
  fixture.companyNames = { [COMPANY]: COMPANY_NAME, [OTHER_COMPANY]: "Other Company" };
  fixture.payoutRows = [
    report(1),
    report(2, { created_at: "2026-09-20T12:30:00Z", company_amount: "91" }),
    report(3, { currency: "EUR", company_amount: "80" }),
    report(4, { company_id: OTHER_COMPANY, company_amount: "999" }),
    report(5, {
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      company_amount: "70",
    }),
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  return fixture;
}

for (const [role, width] of [
  ["operator", 1440],
  ["operator", 1920],
  ["operator", 834],
  ["company_member", 390],
]) {
  test(`${role} browses month groups and exact-scope history at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await setup(page, role);
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
    await expect(table.getByRole("heading", { name: "May 2026", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "91 USD", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report month", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report company", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report versions", { exact: true })).toHaveCount(0);
    expect(historyReads(fixture)).toHaveLength(0);
    if (role === "company_member") {
      await expect(table.getByRole("cell", { name: "999 USD", exact: true })).toHaveCount(0);
      await expect(table.getByRole("button", { name: "Company", exact: true })).toHaveCount(0);
    }

    const toggle = page.getByRole("button", { name: `Show versions for ${scope}`, exact: true });
    await toggle.focus();
    await toggle.press("Enter");
    const history = page.getByRole("region", { name: `Report versions for ${scope}`, exact: true });
    await expect(history).toBeVisible();
    await expect(history.getByRole("cell", { name: "91 USD", exact: true })).toBeVisible();
    await expect(history).not.toContainText("999 USD");
    await expect(history).not.toContainText("80 EUR");
    await expect(history).not.toContainText("70 USD");
    await expect
      .poll(() => historyReads(fixture).filter(({ completed }) => completed).length)
      .toBe(1);
    const request = historyReads(fixture).find(({ completed }) => completed).params;
    expect(request.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(request.get("start_date")).toBe("eq.2026-06-01");
    expect(request.get("end_date")).toBe("eq.2026-06-30");
    expect(request.get("currency")).toBe("eq.USD");
    await expect
      .poll(() =>
        page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`grouped-payouts-${role}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}

test("column filters and historical selection survive F5 without returning to the latest version", async ({
  page,
}) => {
  const fixture = await setup(page, "operator");
  await selectColumnOptions(page, "Company", [COMPANY_NAME]);
  await applyReportMonth(page, "2026-06");
  await expect(page.getByRole("heading", { name: "May 2026", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "999 USD", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
  const history = page.getByRole("region", { name: `Report versions for ${scope}`, exact: true });
  await history.getByRole("button", { name: /^Open previous version created/ }).click();
  let drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(history).toBeVisible();
  await expect(page.getByRole("group", { name: "Applied table filters" })).toContainText(
    "2 filters applied",
  );
  await expect(page.getByRole("heading", { name: "May 2026", exact: true })).toHaveCount(0);
  await history.getByRole("button", { name: "Open latest version", exact: true }).click();
  await expect(drawer).toContainText("Created 2026-09-27 00:00:00 UTC");
  expect(
    historyReads(fixture).every(({ params }) => params.get("company_id") === `eq.${COMPANY}`),
  ).toBe(true);
});

test("older reports pagination keeps month groups and the current page after F5", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  fixture.payoutRows = Array.from({ length: 26 }, (_, index) => {
    const month = new Date(Date.UTC(2026, 5 - index, 1));
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    return report(index + 1, {
      start_date: month.toISOString().slice(0, 10),
      end_date: lastDay.toISOString().slice(0, 10),
      company_amount: String(1000 + index),
    });
  });
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByLabel("Rows", { exact: true }).selectOption("25");
  await expect(page.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
  const older = page.getByRole("button", { name: "Next", exact: true });
  await older.focus();
  await older.press("Enter");
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "May 2024", exact: true })).toBeVisible();
  await expect(older).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "May 2024", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
  expect(historyReads(fixture)).toHaveLength(0);
});

test("version pagination reads only the requested scope and restores an older page after F5", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  fixture.payoutRows = Array.from({ length: 51 }, (_, index) =>
    report(index + 1, {
      created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, 51 - index)).toISOString(),
      company_amount: String(1000 + index),
    }),
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
  const history = page.getByRole("region", { name: `Report versions for ${scope}`, exact: true });
  await expect(history.getByRole("table").locator("tbody tr")).toHaveCount(50);
  await expect(history.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await history.getByRole("button", { name: "Next", exact: true }).click();
  await expect(history.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(history.getByRole("cell", { name: "1,050 USD", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  expect(historyReads(fixture).at(-1).params.get("offset")).toBe("50");
  await history.getByRole("button", { name: /^Open previous version created/ }).click();
  const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await page.reload();
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(history.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(history.getByRole("table").locator("tbody tr")).toHaveCount(50);
  await expect(
    history.getByRole("button", { name: "Open latest version", exact: true }),
  ).toBeVisible();
});

test("currency-free zero reports load only currency-free history", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  fixture.payoutRows = [
    report(1, { currency: null, source_amount: "0", fee_amount: "0", company_amount: "0" }),
    report(2, {
      currency: null,
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
      created_at: "2026-09-20T12:30:00Z",
    }),
    report(3),
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  const zeroScope = `${COMPANY_NAME} · June 2026 · No currency`;
  await page.getByRole("button", { name: `Show versions for ${zeroScope}`, exact: true }).click();
  const history = page.getByRole("region", {
    name: `Report versions for ${zeroScope}`,
    exact: true,
  });
  await expect(history.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await expect(history.getByRole("cell", { name: "0", exact: true })).toHaveCount(6);
  await expect(history).not.toContainText("USD");
  expect(historyReads(fixture).at(-1).params.get("currency")).toBe("is.null");
  await history.getByRole("button", { name: /^Open previous version created/ }).click();
  const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  await page.reload();
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  expect(historyReads(fixture).every(({ params }) => params.get("currency") === "is.null")).toBe(
    true,
  );
});

test("an inspected version stays open when publication shifts it beyond the history page", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  fixture.payoutRows = Array.from({ length: 50 }, (_, index) =>
    report(index + 1, {
      created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, 50 - index)).toISOString(),
      company_amount: String(1000 + index),
    }),
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
  const history = page.getByRole("region", { name: `Report versions for ${scope}`, exact: true });
  await history
    .getByRole("button", {
      name: "Open previous version created 2026-09-27 00:00:01 UTC",
      exact: true,
    })
    .click();
  const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  const completedPolls = () => fixture.revisionRequests.filter(({ completed }) => completed).length;
  const pollsBefore = completedPolls();
  fixture.payoutRows.push(report(51, { created_at: "2026-10-01T00:00:00Z" }));
  fixture.revisions.payouts = "new-snapshot";
  await page.clock.fastForward(60_000);
  await expect.poll(completedPolls).toBeGreaterThan(pollsBefore);
  await expect(history.getByRole("button", { name: "Next", exact: true })).toBeAttached();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await page.reload();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await expect
    .poll(() =>
      historyReads(fixture).some(
        ({ params }) => params.get("id") === `eq.${fixture.payoutRows[49].id}`,
      ),
    )
    .toBe(true);
});
