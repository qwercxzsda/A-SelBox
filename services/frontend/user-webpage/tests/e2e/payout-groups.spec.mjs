import {
  payoutHistoryControls,
  payoutHistoryRows,
  payoutLatestRow,
  payoutScopeRows,
} from "./payout-history-actions.mjs";
import { expect, test } from "./accessibility-fixture.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyReportMonth, selectColumnOptions, columnTrigger } from "./table-actions.mjs";

const COMPANY = "0198b50b-701a-7000-8000-000000000001";
const OTHER_COMPANY = "0198b50b-701a-7000-8000-000000000002";
const COMPANY_NAME = "Monthly Company";
const scope = `${COMPANY_NAME} · June 2026 · Amazon.com · USD`;
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

for (const role of ["administrator", "member"]) {
  test(`${role} finds payout months by their browser-formatted labels`, async ({ page }) => {
    const fixture = await setup(page, role);
    const search = page.getByRole("searchbox", { name: "Search", exact: true });
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    for (const text of ["June", "june 2026"]) {
      await search.fill(text);
      await expect(table.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
      await expect(table.getByRole("heading", { name: "May 2026", exact: true })).toHaveCount(0);
    }
    await page.reload();
    await expect(search).toHaveValue("june 2026");
    await expect(table.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
    await search.fill("May");
    await expect(table.getByRole("heading", { name: "May 2026", exact: true })).toBeVisible();
    await expect(table.getByRole("heading", { name: "June 2026", exact: true })).toHaveCount(0);
    expect(
      fixture.requests
        .filter((entry) => entry.dataset === "payouts" && entry.params.has("or"))
        .at(-1)
        .params.get("or"),
    ).toContain('start_date.in.("2026-05-01")');
  });
}

for (const [role, width] of [
  ["administrator", 1440],
  ["administrator", 1920],
  ["administrator", 834],
  ["member", 390],
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
    await expect(table.getByRole("cell", { name: "91.00 USD", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report month", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report company", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Report versions", { exact: true })).toHaveCount(0);
    expect(historyReads(fixture)).toHaveLength(0);
    if (role === "member") {
      await expect(table.getByRole("cell", { name: "999.00 USD", exact: true })).toHaveCount(0);
      await expect(columnTrigger(table, "Company")).toHaveCount(0);
    }

    const toggle = page.getByRole("button", { name: `Show versions for ${scope}`, exact: true });
    const headings = await table.locator(":scope > thead th").allTextContents();
    await toggle.focus();
    await toggle.press("Enter");
    await expect(table.locator("table")).toHaveCount(0);
    await expect(table.locator(":scope > thead")).toHaveCount(1);
    await expect(table.locator(":scope > thead th")).toHaveText(headings);
    await expect(payoutHistoryRows(page, scope)).toHaveCount(1);
    const latest = payoutLatestRow(page, scope);
    const scopeRows = payoutScopeRows(page, scope);
    const marketplace = latest.locator('[data-column="marketplace_name"]');
    await expect(marketplace).toHaveAttribute("rowspan", "2");
    await expect(scopeRows.locator('[data-column="marketplace_name"]')).toHaveCount(1);
    await expect(
      marketplace.getByRole("button", { name: `Hide versions for ${scope}`, exact: true }),
    ).toBeVisible();
    await expect(latest.locator('[data-column="created_at"]').getByRole("button")).toHaveCount(0);
    await expect(scopeRows.locator('[data-column="company_id"]')).toHaveCount(
      role === "administrator" ? 1 : 0,
    );
    if (role === "administrator")
      await expect(latest.locator('[data-column="company_id"]')).toHaveAttribute("rowspan", "2");
    await expect(payoutHistoryRows(page, scope)).toHaveAttribute("aria-haspopup", "dialog");
    await expect(
      payoutHistoryRows(page, scope).getByRole("cell", { name: "91.00 USD", exact: true }),
    ).toBeVisible();
    for (const amount of ["999.00 USD", "80.00 EUR", "70.00 USD"])
      await expect(
        payoutHistoryRows(page, scope).getByRole("cell", { name: amount, exact: true }),
      ).toHaveCount(0);
    await expect(table.getByRole("cell", { name: "95.00 USD", exact: true })).toHaveCount(1);
    const monthGroup = table
      .locator("tbody.payout-month-group")
      .filter({ has: page.getByRole("heading", { name: "June 2026", exact: true }) });
    await expect
      .poll(async () =>
        Number(await monthGroup.locator(".month-group-cell").getAttribute("rowspan")),
      )
      .toBe(await monthGroup.locator(":scope > tr").count());
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
  const fixture = await setup(page, "administrator");
  await selectColumnOptions(page, "Company", [COMPANY_NAME]);
  await applyReportMonth(page, "2026-06");
  await expect(page.getByRole("heading", { name: "May 2026", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "999.00 USD", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
  await payoutHistoryRows(page, scope).press("Enter");
  let drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(payoutHistoryRows(page, scope)).toHaveAttribute("aria-selected", "true");
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  await page.reload();
  drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Created 2026-09-20 12:30:00 UTC");
  await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(payoutHistoryRows(page, scope)).toBeVisible();
  await expect(page.getByRole("group", { name: "Applied table filters" })).toContainText(
    "2 filters applied",
  );
  await expect(page.getByRole("heading", { name: "May 2026", exact: true })).toHaveCount(0);
  await payoutLatestRow(page, scope).press("Space");
  await expect(drawer).toContainText("Created 2026-09-27 00:00:00 UTC");
  expect(
    historyReads(fixture).every(({ params }) => params.get("company_id") === `eq.${COMPANY}`),
  ).toBe(true);
});

test("several expanded scopes share the original headings and month group without duplicating reports", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, "administrator");
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  const june = table
    .locator("tbody.payout-month-group")
    .filter({ has: page.getByRole("heading", { name: "June 2026", exact: true }) });
  const baselineRows = await june.locator(":scope > tr").count();
  await page.getByRole("button", { name: `Show versions for ${scope}`, exact: true }).click();
  const previous = payoutHistoryRows(page, scope);
  await expect(previous).toHaveCount(1);
  await expect(june.locator(":scope > tr")).toHaveCount(baselineRows + 1);
  await expect(june.locator(".month-group-cell")).toHaveAttribute(
    "rowspan",
    String(baselineRows + 1),
  );
  await expect(table.locator("table")).toHaveCount(0);
  await expect(table.locator("thead")).toHaveCount(1);
  const headings = table.locator("thead th");
  const values = previous.locator(":scope > td");
  await expect(values).toHaveCount(4);
  const columns = await headings.evaluateAll((cells) =>
    cells
      .filter((cell) =>
        ["created_at", "source_amount", "fee_amount", "company_amount"].includes(
          cell.dataset.column,
        ),
      )
      .map((cell) => ({
        left: cell.getBoundingClientRect().left,
        width: cell.getBoundingClientRect().width,
      })),
  );
  const rowColumns = await values.evaluateAll((cells) =>
    cells.map((cell) => ({
      left: cell.getBoundingClientRect().left,
      width: cell.getBoundingClientRect().width,
    })),
  );
  for (const [index, column] of rowColumns.entries()) {
    expect(column.left).toBeCloseTo(columns[index].left, 0);
    expect(column.width).toBeCloseTo(columns[index].width, 0);
  }
  const otherScope = `${COMPANY_NAME} · June 2026 · Amazon.com · EUR`;
  await page.getByRole("button", { name: `Show versions for ${otherScope}`, exact: true }).click();
  await expect(payoutHistoryControls(page, otherScope)).toContainText("No previous versions.");
  await expect(june.locator(":scope > tr")).toHaveCount(baselineRows + 2);
  await expect(june.locator(".month-group-cell")).toHaveAttribute(
    "rowspan",
    String(baselineRows + 2),
  );
  await expect(payoutLatestRow(page, otherScope)).toHaveCount(1);
  for (const expandedScope of [scope, otherScope]) {
    const latest = payoutLatestRow(page, expandedScope);
    for (const column of ["company_id", "marketplace_name"]) {
      await expect(
        payoutScopeRows(page, expandedScope).locator(`[data-column="${column}"]`),
      ).toHaveCount(1);
      await expect(latest.locator(`[data-column="${column}"]`)).toHaveAttribute("rowspan", "2");
    }
  }
  await expect(june.locator('[data-column="company_id"]')).toHaveCount(3);
  await expect(june.locator('[data-column="marketplace_name"]')).toHaveCount(3);
  const controlsCell = payoutHistoryControls(page, otherScope).locator("xpath=ancestor::td");
  await expect(controlsCell).toHaveAttribute("colspan", "4");
  const updatedHeading = table.locator('thead [data-column="created_at"]');
  expect((await controlsCell.boundingBox()).x).toBeCloseTo(
    (await updatedHeading.boundingBox()).x,
    0,
  );
  await expectAccessible("inline-payout-versions");
  await previous.press("Enter");
  await expect(previous).toHaveAttribute("aria-selected", "true");
  await expect(payoutLatestRow(page, scope)).toHaveAttribute("aria-selected", "false");
  await expect(payoutLatestRow(page, otherScope)).toHaveAttribute("aria-selected", "false");
  await page.getByRole("button", { name: "Close row details", exact: true }).click();
  await payoutLatestRow(page, scope).press("Space");
  await expect(payoutLatestRow(page, scope)).toHaveAttribute("aria-selected", "true");
  await expect(previous).toHaveAttribute("aria-selected", "false");
  for (const column of ["company_id", "marketplace_name"])
    await expect(payoutLatestRow(page, scope).locator(`[data-column="${column}"]`)).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  await page.getByRole("button", { name: "Close row details", exact: true }).click();
  await page.getByRole("button", { name: `Hide versions for ${scope}`, exact: true }).click();
  await expect(previous).toHaveCount(0);
  await expect(payoutLatestRow(page, scope).locator('[data-column="company_id"]')).toHaveAttribute(
    "rowspan",
    "1",
  );
  await expect(
    payoutLatestRow(page, scope).locator('[data-column="marketplace_name"]'),
  ).toHaveAttribute("rowspan", "1");
  await expect(june.locator(".month-group-cell")).toHaveAttribute(
    "rowspan",
    String(baselineRows + 1),
  );
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
  const history = payoutHistoryControls(page, scope);
  await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
  await expect(history.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await history.getByRole("button", { name: "Next", exact: true }).click();
  await expect(payoutHistoryRows(page, scope)).toHaveCount(1);
  await expect(
    payoutHistoryRows(page, scope).getByRole("cell", { name: "1,050.00 USD", exact: true }),
  ).toBeVisible();
  await expect(history.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  expect(historyReads(fixture).at(-1).params.get("offset")).toBe("50");
  await payoutHistoryRows(page, scope).click();
  const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await page.reload();
  await expect(drawer).toContainText("Created 2026-09-27 00:00:01 UTC");
  await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(history.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(payoutHistoryRows(page, scope)).toHaveCount(49);
  await expect(payoutLatestRow(page, scope)).toBeVisible();
});

test("currency-free zero reports load only currency-free history", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyNames[COMPANY] = COMPANY_NAME;
  fixture.payoutRows = [
    report(1, {
      marketplace_name: null,
      currency: null,
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
    }),
    report(2, {
      marketplace_name: null,
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
  const zeroScope = `${COMPANY_NAME} · June 2026 · Not specified · No currency`;
  await page.getByRole("button", { name: `Show versions for ${zeroScope}`, exact: true }).click();
  const versions = payoutHistoryRows(page, zeroScope);
  await expect(versions).toHaveCount(1);
  await expect(versions.getByRole("cell", { name: "0.00", exact: true })).toHaveCount(3);
  await expect(versions).not.toContainText("USD");
  expect(historyReads(fixture).at(-1).params.get("currency")).toBe("is.null");
  await versions.click();
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
  const history = payoutHistoryControls(page, scope);
  await payoutHistoryRows(page, scope).filter({ hasText: "2026-09-27 00:00:01 UTC" }).click();
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
