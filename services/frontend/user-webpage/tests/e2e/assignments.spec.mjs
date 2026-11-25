import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  OTHER_COMPANY,
  PRODUCT_COMPANY,
  assignmentDrawer,
  assignmentEditor,
  assignmentRow,
  assignmentTable,
  automaticVersion,
  openAssignments,
  referenceAssignment,
  setupAssignments,
  unassignedReference,
} from "./assignment-fixtures.mjs";
import { companyCreation } from "./company-actions.mjs";
import { columnHeader, openColumn, selectColumnOptions } from "./table-actions.mjs";

const summary = (page, text) => page.getByText(text, { exact: true });

/** Like the Fee editor: a footer pinned to the drawer bottom, secondary left, primary right. */
async function expectFeeEditorFooter(editor) {
  const footer = editor.locator(".editing-drawer-actions");
  const cancel = footer.getByRole("button", { name: "Cancel", exact: true });
  const save = footer.getByRole("button", { name: "Save", exact: true });
  await expect(cancel).toBeVisible();
  await expect(save).toBeVisible();
  const [panel, bar, left, right] = await Promise.all(
    [editor, footer, cancel, save].map((locator) => locator.boundingBox()),
  );
  expect(Math.abs(panel.y + panel.height - (bar.y + bar.height))).toBeLessThan(1);
  expect(left.x).toBeLessThan(bar.x + bar.width / 2);
  expect(right.x + right.width).toBeGreaterThan(bar.x + bar.width / 2);
}
const notice = (page) => page.getByRole("status").filter({ hasText: /^Assignment saved: / });
const NEWER_VERSION = "0198b50b-701a-7000-8000-000000000099";

test("members read only their own assignments, without companies, statuses or editing", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "member", [
    referenceAssignment("own-campaign", { marketplace_names: ["Amazon.de"] }),
    referenceAssignment("other-promotion", { kind: "PROMOTION", company_id: OTHER_COMPANY }),
    unassignedReference("loose-shipment", { kind: "SHIPMENT" }),
  ]);
  await signIn(page);
  const tabs = page.getByRole("tablist", { name: "Workspace data", exact: true });
  // Initial dev-server compilation can outlast the authentication request.
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  await expect(tabs.getByRole("tab")).toHaveText([
    "Transactions",
    "Inventory",
    "Payout reports",
    "Current fees",
    "Assignments",
  ]);
  await openAssignments(page);
  await expect(summary(page, "1 assignment")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search assignments" })).toHaveAttribute(
    "placeholder",
    "Reference ID",
  );
  await expect(assignmentTable(page).getByRole("columnheader")).toHaveText([
    "Reference ID",
    "Source",
    "Marketplace",
  ]);
  await expect(page.getByText(/needs? setup/)).toHaveCount(0);
  await expect(assignmentRow(page, "other-promotion")).toHaveCount(0);

  await assignmentRow(page, "own-campaign").click();
  const drawer = assignmentDrawer(page);
  // The context names the ID, so the body does not repeat it.
  await expect(drawer.locator(".detail-drawer-context")).toHaveText(
    "own-campaign · Campaign · Amazon.de",
  );
  await expect(drawer.getByText("Reference ID", { exact: true })).toHaveCount(0);
  await expect(drawer).toContainText("Product company");
  for (const hidden of ["Edit own-campaign", "Additional details"])
    await expect(drawer.getByRole("button", { name: hidden })).toHaveCount(0);
  await expect(drawer.getByRole("table")).toHaveCount(0);
  expect(fixture.events.some(({ endpoint }) => endpoint.endsWith("/assignment_versions"))).toBe(
    false,
  );
  expect(fixture.referenceAssignmentRequests.at(-1).user).toBe("member-a");
});

test("administrators filter the complete list in the browser with exact totals and URL state", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [
    referenceAssignment("c-campaign"),
    referenceAssignment("b-promotion", {
      kind: "PROMOTION",
      company_id: OTHER_COMPANY,
      marketplace_names: ["Amazon.com", "Amazon.de"],
    }),
    unassignedReference("a-shipment", { kind: "SHIPMENT", marketplace_names: [] }),
    referenceAssignment("d-campaign", { warning: "PRODUCTS_DISAGREE" }),
  ]);
  await signIn(page);
  await openAssignments(page);
  await expect(summary(page, "1–4 of 4 assignments")).toBeVisible();
  await expect(assignmentTable(page).getByRole("rowheader")).toHaveText([
    "a-shipment",
    "b-promotion",
    "c-campaign",
    "d-campaign",
  ]);
  const promotion = assignmentRow(page, "b-promotion");
  await expect(promotion.getByRole("cell", { name: "2 marketplaces" })).toHaveAttribute(
    "title",
    "Amazon.com, Amazon.de",
  );
  // "Unassigned" is a value like a company name, set like Current fees; only "—" is muted.
  const unassigned = assignmentRow(page, "a-shipment");
  await expect(unassigned.getByRole("cell", { name: "Unassigned", exact: true })).toBeVisible();
  await expect(unassigned.locator(".muted-value")).toHaveText("—");
  await expect(assignmentRow(page, "a-shipment").locator(".ui-status-badge")).toHaveText(
    "Needs setup",
  );
  await expect(assignmentRow(page, "d-campaign").locator(".ui-status-badge")).toHaveText(
    "Products disagree",
  );
  await expect(assignmentRow(page, "c-campaign").locator(".ui-status-badge")).toHaveText("Saved");

  // Known values are constants: the menu lists marketplaces no loaded row names.
  const marketplaces = await openColumn(page, "Marketplace");
  await expect(marketplaces.getByRole("checkbox", { name: "Amazon.co.jp" })).toBeVisible();
  await marketplaces.getByRole("checkbox", { name: "Amazon.de", exact: true }).check();
  await marketplaces.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(summary(page, "1 assignment")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();

  await selectColumnOptions(page, "Company", ["Unassigned"]);
  await expect(assignmentTable(page).getByRole("rowheader")).toHaveText(["a-shipment"]);
  await page.getByRole("button", { name: "Remove Company: Unassigned", exact: true }).click();
  await selectColumnOptions(page, "Status", ["Products disagree"]);
  await selectColumnOptions(page, "Source", ["Campaign"]);
  await expect(assignmentTable(page).getByRole("rowheader")).toHaveText(["d-campaign"]);
  await expect(page).toHaveURL(/source=CAMPAIGN/);
  await expect(page).toHaveURL(/status=products-disagree/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Source: Campaign" })).toBeVisible();
  await expect(assignmentTable(page).getByRole("rowheader")).toHaveText(["d-campaign"]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();

  const search = page.getByRole("searchbox", { name: "Search assignments" });
  await expect(search).toHaveAttribute("placeholder", "Reference ID or company");
  await search.fill("other company");
  await expect(assignmentTable(page).getByRole("rowheader")).toHaveText(["b-promotion"]);
  await expect(page.getByRole("group", { name: "Applied assignment filters" })).toHaveCount(0);
  await search.fill("absent");
  await expect(summary(page, "No matching assignments")).toBeVisible();
  await page.getByRole("button", { name: "Reset search and filters", exact: true }).click();
  await expect(summary(page, "1–4 of 4 assignments")).toBeVisible();
  await expect(columnHeader(assignmentTable(page), "Company")).toHaveCount(1);
});

test("the needs-setup alert opens the next ID in the editor and a save names it", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [
    referenceAssignment("assigned-campaign"),
    unassignedReference("b-unassigned"),
    unassignedReference("a-unassigned", { kind: "PROMOTION" }),
  ]);
  await signIn(page);
  await openAssignments(page);
  const alert = page.getByText("2 IDs need setup", { exact: true });
  await expect(alert).toBeVisible();
  await page.getByRole("button", { name: "Assign next ID", exact: true }).click();
  const editor = assignmentEditor(page);
  // The editor names the ID it assigns and starts on the company, like "Complete next SKU".
  await expect(editor.locator(".detail-drawer-context")).toHaveText(
    "a-unassigned · Promotion · Amazon.com",
  );
  const company = editor.getByRole("combobox", { name: "Company" });
  await expect(company).toBeFocused();
  await expect(company).toHaveValue(PRODUCT_COMPANY);
  await expect(editor.getByText("Suggested: all products belong to this company.")).toBeVisible();
  await expectFeeEditorFooter(editor);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(notice(page)).toHaveText("Assignment saved: a-unassigned · Product company");
  expect(fixture.assignmentSaves.at(-1)).toEqual({
    p_seller_namespace: "us-seller",
    p_amazon_scope: "NA",
    p_kind: "PROMOTION",
    p_native_key: "a-unassigned",
    p_company_id: PRODUCT_COMPANY,
    p_memo: "Administrator updated assignment",
    p_expected_version_id: null,
  });
  const saved = assignmentRow(page, "a-unassigned");
  await expect(saved).toBeFocused();
  await expect(saved.locator(".ui-status-badge")).toHaveText("Saved");
  await expect(page.getByText("1 ID needs setup", { exact: true })).toBeVisible();
});

test("administrators review products and history, then change, conflict and clear", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupAssignments(
    fixture,
    "administrator",
    [referenceAssignment("campaign-42", { marketplace_names: ["Amazon.de"] })],
    [automaticVersion()],
  );
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-42").click();
  const drawer = assignmentDrawer(page);
  await expect(drawer.locator(".detail-drawer-context")).toHaveText(
    "campaign-42 · Campaign · Amazon.de",
  );
  await expect(drawer).toContainText("Assigned automatically");
  await expect(
    drawer.getByRole("button", { name: "Show transactions for ALPHA-1", exact: true }),
  ).toBeVisible();
  const history = drawer.getByRole("table", { name: "Assignment history", exact: true });
  await expect(history.getByRole("row")).toHaveCount(2);
  await expect(history).toContainText("Automatically assigned from product ownership");
  await expect(drawer.getByRole("button", { name: "Additional details" })).toBeVisible();

  await drawer.getByRole("button", { name: "Edit campaign-42", exact: true }).click();
  const editor = assignmentEditor(page);
  await expect(editor.getByRole("combobox", { name: "Company" })).toBeFocused();
  const save = editor.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await editor.getByRole("combobox", { name: "Company" }).selectOption("Other company");
  await expect(editor.getByText("Unsaved change.", { exact: true })).toBeVisible();
  // A failed save is titled like a failed read, with the cause beneath it.
  fixture.assignmentSaveStatus = 500;
  await save.click();
  const problem = editor.getByRole("alert");
  await expect(problem.locator(".mantine-Alert-title")).toHaveText("Could not save the assignment");
  await expect(problem.locator(".mantine-Alert-message")).toHaveText(
    "The server returned HTTP 500.",
  );
  // Save tries again; the alert offers no Retry of its own.
  await expect(problem.getByRole("button")).toHaveCount(0);
  fixture.assignmentSaveStatus = null;
  // Another administrator saved first: the save is refused and the editor offers the newer one.
  fixture.referenceAssignments[0].current_version_id = NEWER_VERSION;
  await save.click();
  const changed = editor.getByRole("alert").filter({ hasText: "Assignment changed elsewhere" });
  await expect(changed.locator(".mantine-Alert-title")).toHaveText("Assignment changed elsewhere");
  await expect(changed.locator(".mantine-Text-root")).toHaveText("Your choice is kept.");
  await expect(editor.getByText("Could not save the assignment", { exact: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await changed.getByRole("button", { name: "Load latest", exact: true }).click();
  await expect(changed).toHaveCount(0);
  const company = editor.getByRole("combobox", { name: "Company" });
  await expect(company).toBeFocused();
  await company.selectOption("Other company");
  await save.click();
  await expect(notice(page)).toHaveText("Assignment saved: campaign-42 · Other company");
  expect(fixture.assignmentSaves.at(-1).p_expected_version_id).toBe(NEWER_VERSION);

  await assignmentRow(page, "campaign-42").click();
  await drawer.getByRole("button", { name: "Edit campaign-42", exact: true }).click();
  await editor.getByRole("combobox", { name: "Company" }).selectOption("Unassigned");
  await editor.getByLabel("Reason (optional)").fill("Release campaign");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notice(page)).toHaveText("Assignment saved: campaign-42 · Unassigned");
  await expect(fixture.assignmentSaves.at(-1).p_memo).toBe("Release campaign");
  const row = assignmentRow(page, "campaign-42");
  await expect(row).toContainText("Unassigned");
  await expect(row.locator(".ui-status-badge")).toHaveText("Needs setup");

  await row.click();
  await expect(drawer).toContainText("Cleared by an administrator");
  // The warning is said once, as the alert; the list keeps the Status column.
  await expect(drawer.getByText("Needs setup", { exact: true })).toHaveCount(1);
  await expect(drawer.getByText("Status", { exact: true })).toHaveCount(0);
  await expect(history.getByRole("row")).toHaveCount(4);
  await expect(history.getByRole("row").nth(1)).toContainText("Release campaign");
  await expect(history.getByRole("row").nth(2)).toContainText("Other company");
  await drawer.getByRole("button", { name: "Show transactions for ALPHA-1", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(columnHeader(page, "SKU")).toHaveAccessibleName("SKU 1 selected");
});

test("Cancel returns to the details and the pager waits for the list", async ({ page }) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [unassignedReference("campaign-5")]);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  fixture.beforeReferenceAssignments = () => held;
  await signIn(page);
  await openAssignments(page);
  const controls = page.getByRole("group", { name: "Assignment controls", exact: true });
  // Nothing is counted yet, so the pager claims no page count.
  await expect(controls.getByRole("form", { name: "Page 1 of —", exact: true })).toBeVisible();
  release();
  await expect(controls.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();

  await assignmentRow(page, "campaign-5").click();
  const drawer = assignmentDrawer(page);
  await drawer.getByRole("button", { name: "Edit campaign-5", exact: true }).click();
  const editor = assignmentEditor(page);
  await editor.getByRole("combobox", { name: "Company" }).selectOption("Other company");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Edit campaign-5", exact: true })).toBeFocused();
  await expect(drawer).toContainText("Unassigned");
  expect(fixture.assignmentSaves).toEqual([]);
});

test("a long history keeps its headings under the drawer header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const fixture = await mockSupabase(page);
  const current = automaticVersion();
  const versions = Array.from({ length: 30 }, (_, index) =>
    index === 0
      ? { ...current, version_number: "30", origin: "ADMINISTRATOR", memo: "Latest" }
      : automaticVersion({
          id: `0198b50b-701a-7000-8000-${String(700 + index).padStart(12, "0")}`,
          version_number: String(30 - index),
        }),
  );
  setupAssignments(fixture, "administrator", [referenceAssignment("campaign-9")], versions);
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-9").click();
  const drawer = assignmentDrawer(page);
  const history = drawer.getByRole("table", { name: "Assignment history", exact: true });
  await expect(history.getByRole("row")).toHaveCount(31);
  // Details scroll below the fixed header, like Fee details; headings stick to its edge.
  await history.getByRole("row").last().scrollIntoViewIfNeeded();
  const header = await drawer.locator(".ui-drawer-header").boundingBox();
  await expect
    .poll(async () => Math.round((await history.locator("thead").boundingBox()).y))
    .toBe(Math.round(header.y + header.height));
});

test("Add company keeps the unsaved choice and returns to the editor", async ({ page }) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [unassignedReference("campaign-7")]);
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-7").click();
  await assignmentDrawer(page)
    .getByRole("button", { name: "Edit campaign-7", exact: true })
    .click();
  const editor = assignmentEditor(page);
  await editor.getByLabel("Reason (optional)").fill("Kept while adding a company");
  await editor.getByRole("button", { name: "Add company", exact: true }).click();
  await companyCreation(page)
    .getByRole("button", { name: "Return to Assignments", exact: true })
    .click();
  await expect(editor.getByLabel("Reason (optional)")).toHaveValue("Kept while adding a company");
  await expect(page).toHaveURL(/tab=assignments/);
  await expect(page).not.toHaveURL(/Kept/);
});

test("a version saved elsewhere while editing blocks Save until the editor loads it", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  setupAssignments(
    fixture,
    "administrator",
    [referenceAssignment("campaign-42")],
    [automaticVersion()],
  );
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-42").click();
  await assignmentDrawer(page)
    .getByRole("button", { name: "Edit campaign-42", exact: true })
    .click();
  const editor = assignmentEditor(page);
  const company = editor.getByRole("combobox", { name: "Company" });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  await company.selectOption("Other company");
  // Another administrator clears the assignment; the revision poll refetches the open list.
  const reads = fixture.referenceAssignmentRequests.length;
  Object.assign(fixture.referenceAssignments[0], {
    company_id: null,
    current_version_id: NEWER_VERSION,
    assignment_origin: "ADMINISTRATOR",
    warning: "NO_ASSIGNMENT",
  });
  fixture.revisions.references = String(Number(fixture.revisions.references) + 1);
  await page.clock.fastForward("01:05");
  await expect.poll(() => fixture.referenceAssignmentRequests.length).toBeGreaterThan(reads);
  const changed = editor.getByRole("alert").filter({ hasText: "Assignment changed elsewhere" });
  await expect(changed).toBeVisible();
  await expect(save).toBeDisabled();
  // A reload keeps the choice and the version editing started from.
  await page.reload();
  await expect(changed).toBeVisible();
  await expect(save).toBeDisabled();
  expect(fixture.assignmentSaves).toHaveLength(0);
  await changed.getByRole("button", { name: "Load latest", exact: true }).click();
  await company.selectOption("Other company");
  await save.click();
  await expect(notice(page)).toHaveText("Assignment saved: campaign-42 · Other company");
  expect(fixture.assignmentSaves.map((args) => args.p_expected_version_id)).toEqual([
    NEWER_VERSION,
  ]);
});

test("a link to an ID the list does not hold leaves the URL in place", async ({ page }) => {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [unassignedReference("campaign-5")]);
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-5").click();
  await expect(assignmentDrawer(page)).toBeVisible();
  const link = new URL(page.url());
  const key = JSON.parse(link.searchParams.get("row"));
  link.searchParams.set("row", JSON.stringify([...key.slice(0, 3), "campaign-gone"]));
  await page.goto(`${link.pathname}${link.search}`);
  await expect(assignmentRow(page, "campaign-5")).toBeVisible();
  await expect(page).not.toHaveURL(/row=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The correction replaces the link's history entry: Back returns to the open details.
  await page.goBack();
  await expect(page).toHaveURL(/campaign-5/);
  await expect(assignmentDrawer(page)).toBeVisible();
});
