import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { editor, openEditor, setup } from "./sku-configuration-fixtures.mjs";

const targetUser = "00000000-0000-4000-8000-000000000001";
const company = "00000000-0000-4000-8000-00000000000a";
const membership = (page) => page.getByRole("dialog", { name: "Company membership", exact: true });
const rateChange = (page) =>
  editor(page).getByRole("region", { name: "Change rate from date", exact: true });

async function openMembership(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.roles[targetUser] = "member";
  fixture.accountEmails[targetUser] = "keyboard-member@example.test";
  fixture.companyIds[targetUser] = company;
  fixture.companyNames[company] = "Keyboard Company";
  await signIn(page);
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByText("keyboard-member@example.test", { exact: true }) })
    .click();
  return fixture;
}

test("membership confirmation and cancellation keep keyboard focus on the current action", async ({
  page,
}) => {
  const fixture = await openMembership(page);
  const revoke = membership(page).getByRole("button", { name: "Revoke membership", exact: true });
  await revoke.focus();
  await revoke.press("Enter");
  await expect(membership(page).getByRole("alert")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    membership(page).getByRole("button", { name: "Confirm revocation", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(revoke).toBeFocused();
  expect(fixture.membershipRequests).toHaveLength(0);
});

test("saved membership keeps focus in the drawer when its editor is replaced", async ({ page }) => {
  const fixture = await openMembership(page);
  await membership(page).getByRole("button", { name: "Revoke membership", exact: true }).click();
  await membership(page).getByRole("button", { name: "Confirm revocation", exact: true }).click();
  const notice = membership(page).getByRole("status");
  await expect(notice).toContainText("Membership revoked. This user is now Unassigned.");
  await expect(notice).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    membership(page).getByRole("button", { name: "Add company", exact: true }),
  ).toBeFocused();
  expect(fixture.membershipRequests).toHaveLength(1);
});

test("an invalid SKU returns focus to its error after scrolling through fee periods", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  const sku = editor(page).getByRole("combobox", { name: "SKU", exact: true });
  await sku.fill("   ");
  for (let index = 0; index < 5; index += 1)
    await editor(page).getByRole("button", { name: "Add fee period", exact: true }).click();
  await expect(sku).not.toBeInViewport();
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(sku).toBeFocused();
  await expect(sku).toBeInViewport();
  await expect(sku).toHaveAttribute("aria-invalid", "true");
  await expect(editor(page).getByText("Enter a SKU.", { exact: true })).toBeInViewport();
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("rate-change validation focuses the first invalid field and preserves entered values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const fixture = await setup(page);
  await openEditor(page);
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const helper = rateChange(page);
  const date = helper.getByLabel("New rate effective date", { exact: true });
  const rate = helper.getByLabel("New fee rate (%)", { exact: true });
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await date.fill("2026-09-02");
  await rate.fill("101");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await expect(rate).toBeFocused();
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await expect(date).toHaveValue("2026-09-02");
  await rate.fill("6");
  await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
  await expect(
    helper.getByRole("button", { name: "Use rate change in draft", exact: true }),
  ).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("phone fee fields have room for their values and keep actions reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await setup(page);
  await openEditor(page);
  const labels = [
    "Marketplace 1",
    "Fee rate 1 (%)",
    "Start date 1 (inclusive)",
    "End date 1 (exclusive)",
  ];
  const fields = await Promise.all(
    labels.map((label) => editor(page).getByLabel(label, { exact: true }).boundingBox()),
  );
  expect(new Set(fields.map((bounds) => Math.round(bounds.x))).size).toBe(1);
  for (const field of fields) expect(field.width).toBeGreaterThan(280);
  await editor(page).getByLabel(labels[0], { exact: true }).scrollIntoViewIfNeeded();
  await expect(
    editor(page).getByRole("button", { name: "Add fee period", exact: true }),
  ).toBeInViewport();
  await expect(
    editor(page).getByRole("button", { name: "Keep draft", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("phone-fee-fields.png"),
    animations: "disabled",
  });
  await editor(page)
    .getByRole("button", { name: "Change rate from date for period 1", exact: true })
    .click();
  const date = await rateChange(page)
    .getByLabel("New rate effective date", { exact: true })
    .boundingBox();
  const rate = await rateChange(page).getByLabel("New fee rate (%)", { exact: true }).boundingBox();
  expect(Math.round(date.x)).toBe(Math.round(rate.x));
  expect(date.width).toBeGreaterThan(280);
  expect(rate.width).toBeGreaterThan(280);
});

for (const width of [320, 390]) {
  test(`exact fee percentages stay readable without overflow at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await openEditor(page);
    await editor(page)
      .getByRole("button", { name: "Change rate from date for period 1", exact: true })
      .click();
    const helper = rateChange(page);
    await helper.getByLabel("New rate effective date", { exact: true }).fill("2026-09-02");
    await helper.getByLabel("New fee rate (%)", { exact: true }).fill("99.123456");
    await helper.getByRole("button", { name: "Preview rate change", exact: true }).click();
    const percentage = helper.getByRole("cell", { name: "99.123456%", exact: true });
    await percentage.scrollIntoViewIfNeeded();
    const layout = await percentage.evaluate((cell) => {
      const range = globalThis.document.createRange();
      range.selectNodeContents(cell);
      const lines = [...range.getClientRects()];
      const bounds = cell.getBoundingClientRect();
      return {
        lines: lines.length,
        contained: lines.every((line) => line.left >= bounds.left && line.right <= bounds.right),
      };
    });
    expect(layout).toEqual({ lines: 1, contained: true });
    expect(await helper.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await editor(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`phone-rate-preview-${width}.png`),
      animations: "disabled",
    });
  });
}
