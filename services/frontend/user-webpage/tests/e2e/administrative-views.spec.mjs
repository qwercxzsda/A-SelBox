import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

test("administrator lists read CSV pages and independent counts without account bootstrap requests", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.payoutRows = [
    {
      id: "payout-1",
      company_id: "company-member-b",
      currency: "USD",
      source_amount: "9007199254740993.000000000000000002",
      fee_amount: "-0.000000000000000001",
      company_amount: "9007199254740993.000000000000000001",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      created_at: "2026-09-01T00:00:00Z",
    },
  ];
  await signIn(page);
  expect(fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/app_accounts")).toBe(false);
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await expect(table.getByRole("cell", { name: "member-b", exact: true })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Company B", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await expect(
    table.getByRole("cell", { name: "9,007,199,254,740,993.000000000000000001 USD", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  for (const dataset of ["accounts", "payouts"]) {
    await expect
      .poll(
        () =>
          fixture.requests.filter((entry) => entry.dataset === dataset && entry.completed).length,
      )
      .toBe(1);
    await expect
      .poll(
        () =>
          fixture.countRequests.filter((entry) => entry.dataset === dataset && entry.completed)
            .length,
      )
      .toBe(1);
    expect(fixture.requests.find((entry) => entry.dataset === dataset).transport).toBe("rest");
  }
});
