import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { createReplies } from "./mocks/http.mjs";

const company = "0198b50b-701a-7000-8000-000000000041";
const version = "0198b50b-701a-7000-8000-000000000042";

test("administrators can assign a campaign after reviewing product ownership", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyNames[company] = "Product company";
  let owner = null;
  let assignedVersion = null;
  await page.route("**/rest/v1/assignment_status?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const row = {
      kind: "CAMPAIGN",
      seller_namespace: "us-seller",
      amazon_scope: "NA",
      native_key: "campaign-42",
      company_id: owner,
      current_version_id: assignedVersion,
      warning: owner ? null : "NO_ASSIGNMENT",
      suggested_company_id: company,
      assignment_origin: owner ? "MANUAL" : null,
      products: JSON.stringify([{ sku: "ALPHA-1", asin: "B0TESTASIN", company_id: company }]),
    };
    return createReplies(route).csvReply(
      params.get("select").split(","),
      params.has("warning") && owner ? [] : [row],
    );
  });
  await page.route("**/rest/v1/rpc/set_reference_assignment", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_seller_namespace: "us-seller",
      p_amazon_scope: "NA",
      p_kind: "CAMPAIGN",
      p_native_key: "campaign-42",
      p_company_id: owner ? null : company,
      p_expected_version_id: assignedVersion,
      p_memo: owner ? "Release campaign" : "Assign campaign",
    });
    owner = owner ? null : company;
    assignedVersion = version;
    return createReplies(route).reply(version);
  });
  await signIn(page);
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
  await page.getByRole("button", { name: "campaign-42" }).click();
  const editor = page.getByRole("dialog", { name: "Campaign · campaign-42" });
  await expect(editor.getByRole("cell", { name: "ALPHA-1" })).toBeVisible();
  await expect(editor.getByRole("cell", { name: "Product company" })).toBeVisible();
  await editor.getByLabel("Reason for change").fill("Assign campaign");
  await editor.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.getByText("No assignments need attention.")).toBeVisible();
  await page.getByLabel("Warnings only").uncheck();
  await expect(page.getByRole("cell", { name: "Product company", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "campaign-42" }).click();
  await editor.getByRole("combobox", { name: "Assigned company" }).click();
  await page.getByRole("option", { name: "Unassigned", exact: true }).click();
  await editor.getByLabel("Reason for change").fill("Release campaign");
  await editor.getByRole("button", { name: "Clear assignment", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Unassigned", exact: true })).toBeVisible();
});

test("review preserves the posting month and shows exact signed differences for one currency", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await page.route("**/rest/v1/rpc/financial_outcome_page?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get("p_outcome")).toBe("DIFFERENCE");
    return createReplies(route).csvReply(q.get("select").split(","), [
      {
        source_row_id: version,
        seller_namespace: "test-seller",
        amazon_scope: "NA",
        marketplace_name: "Amazon.com",
        currency: "USD",
        posted_date: "2026-04-09",
        component_type: "STORAGE_FEES",
        outcome: "DIFFERENCE",
        reason: "ROUNDING",
        reference_id: "APRIL",
        sku: null,
        skus: JSON.stringify(["ALPHA,1", "ALPHA-2"]),
        base_amount: "-0.0002",
        tax_amount: "0",
        company_id: null,
      },
    ]);
  });
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByLabel("Month", { exact: true }).fill("2026-04");
  await expect(page).toHaveURL(/month=2026-04/);
  const table = page.getByRole("table", { name: "Differences", exact: true });
  await expect(table.getByText("Rounding")).toBeVisible();
  await expect(table.getByText("ALPHA,1, ALPHA-2")).toBeVisible();
  await expect(table.getByText("-0.0002")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-04");
});

test("monthly review compares Finances, companies, SelBox and differences within each currency", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await page.route("**/rest/v1/rpc/financial_outcome_page?*", (route) =>
    createReplies(route).csvReply(
      new URL(route.request().url()).searchParams.get("select").split(","),
      [],
    ),
  );
  await page.route("**/rest/v1/rpc/financial_review_month_page?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return createReplies(route).csvReply(params.get("select").split(","), [
      {
        month: "2026-04-01",
        seller_namespace: "test-seller",
        amazon_scope: "NA",
        marketplace_name: "Amazon.com",
        currency: "USD",
        finances_base: "-10",
        finances_tax: "-1",
        company_base: "-8",
        company_tax: "-0.74",
        selbox_base: "0",
        selbox_tax: "0",
        difference_base: "-2",
        difference_tax: "-0.26",
      },
    ]);
  });
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByRole("combobox", { name: "Show", exact: true }).click();
  await page.getByRole("option", { name: "Monthly totals" }).click();
  const table = page.getByRole("table", { name: "Monthly totals", exact: true });
  await expect(table.getByRole("columnheader", { name: "Finances base" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "-0.26", exact: true })).toBeVisible();
});
