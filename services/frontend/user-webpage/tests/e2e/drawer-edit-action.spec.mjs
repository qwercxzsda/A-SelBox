import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  assignmentDrawer,
  assignmentEditor,
  assignmentRow,
  openAssignments,
  setupAssignments,
  unassignedReference,
} from "./assignment-fixtures.mjs";
import { editor, feeDetails, feeRow, item, setup } from "./sku-configuration-fixtures.mjs";
import { companyDrawer, companyRow } from "./company-actions.mjs";

// Edit acts on the whole record, so Fee details and Assignment details both put it in the
// drawer header beside the close button, never on a row of its own in the body. Company details
// puts View members there the same way.
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

async function openFeeDetails(page) {
  await setup(page, "administrator", [item("S1")]);
  await feeRow(page, "S1").click();
  return { drawer: feeDetails(page), editor: editor(page), name: "Edit S1" };
}

async function openAssignmentDetails(page) {
  const fixture = await mockSupabase(page);
  setupAssignments(fixture, "administrator", [unassignedReference("campaign-5")]);
  await signIn(page);
  await openAssignments(page);
  await assignmentRow(page, "campaign-5").click();
  return {
    drawer: assignmentDrawer(page),
    editor: assignmentEditor(page),
    name: "Edit campaign-5",
  };
}

async function openCompanyDetails(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await signIn(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await companyRow(page, "Company B").click();
  return { drawer: companyDrawer(page), name: "View members" };
}

/** A record action's place in the header: left of Close, centred on its row, then Close by Tab. */
async function expectHeaderEdit(page, drawer, name) {
  const header = drawer.locator(".ui-drawer-header");
  const edit = header.getByRole("button", { name, exact: true });
  const close = header.locator(".ui-close-button");
  await expect(edit).toBeVisible();
  await expect(drawer.locator(".ui-drawer-body").getByRole("button", { name })).toHaveCount(0);
  const [editBox, closeBox] = await Promise.all([edit.boundingBox(), close.boundingBox()]);
  expect(editBox.x + editBox.width).toBeLessThanOrEqual(closeBox.x);
  expect(
    Math.abs(editBox.y + editBox.height / 2 - (closeBox.y + closeBox.height / 2)),
  ).toBeLessThan(1);
  await edit.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  return edit.evaluate((element) => ({
    variant: element.dataset.variant,
    size: element.dataset.size,
    height: element.getBoundingClientRect().height,
    gap:
      element.parentElement.nextElementSibling.getBoundingClientRect().left -
      element.getBoundingClientRect().right,
  }));
}

for (const viewport of VIEWPORTS)
  test(`Fee details and Assignment details put Edit in the header at ${String(viewport.width)}px`, async ({
    browser,
  }) => {
    const measured = [];
    for (const open of [openFeeDetails, openAssignmentDetails]) {
      const page = await browser.newPage({ viewport });
      const { drawer, editor: editorDrawer, name } = await open(page);
      measured.push(await expectHeaderEdit(page, drawer, name));
      // Edit swaps the same drawer to the editor, which has no Edit of its own.
      await drawer.locator(".ui-drawer-header").getByRole("button", { name }).click();
      await expect(editorDrawer).toBeVisible();
      await expect(editorDrawer.getByRole("button", { name, exact: true })).toHaveCount(0);
      await page.close();
    }
    expect(measured[1]).toEqual(measured[0]);
  });

for (const viewport of VIEWPORTS)
  test(`Company details puts View members in the header like Edit at ${String(viewport.width)}px`, async ({
    browser,
  }) => {
    const feePage = await browser.newPage({ viewport });
    const fee = await openFeeDetails(feePage);
    const edit = await expectHeaderEdit(feePage, fee.drawer, fee.name);
    await feePage.close();
    const page = await browser.newPage({ viewport });
    const { drawer, name } = await openCompanyDetails(page);
    expect(await expectHeaderEdit(page, drawer, name)).toEqual(edit);
    // The header action still opens the company's members in User access.
    await drawer.locator(".ui-drawer-header").getByRole("button", { name }).click();
    await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(drawer).toBeHidden();
    await page.close();
  });

test("a member's Fee details has no Edit", async ({ page }) => {
  await setup(page, "member", [item("S1")]);
  await feeRow(page, "S1").click();
  await expect(feeDetails(page)).toBeVisible();
  await expect(feeDetails(page).getByRole("button", { name: /^Edit/ })).toHaveCount(0);
});
