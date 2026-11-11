import { expect, test } from "./accessibility-fixture.mjs";
import { financesRow, kioskRow, liveRow } from "./api-fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { item } from "./sku-configuration-fixtures.mjs";

const ADMIN_TABS = [
  "Transactions",
  "Finances",
  "Data Kiosk",
  "Current fees",
  "Payout reports",
  "User access",
  "Companies",
  "Inventory",
  "Financial review",
];
const MEMBER_TABS = ["Transactions", "Current fees", "Payout reports", "Inventory"];
const workspaceTabs = (page) => page.getByRole("tablist", { name: "Workspace data", exact: true });
const helpButton = (page, title) =>
  page.getByRole("button", { name: `${title} help`, exact: true });
const helpDialog = (page, title) =>
  page.getByRole("dialog", { name: `${title} help`, exact: true });

async function expectConciseHelp(dialog, title) {
  await expect(dialog).toHaveAccessibleName(`${title} help`);
  await expect(dialog.getByText(`${title} help`, { exact: true })).toHaveCount(0);
}

async function helpIconAppearance(button) {
  return button.evaluate((element) => {
    const icon = element.querySelector("svg");
    const style = globalThis.getComputedStyle(icon);
    const opacity = Number(style.opacity) * Number(globalThis.getComputedStyle(element).opacity);
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const parse = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    let background = [255, 255, 255, 255];
    for (let parent = element; parent; parent = parent.parentElement) {
      const color = parse(globalThis.getComputedStyle(parent).backgroundColor);
      if (color[3] === 255) {
        background = color;
        break;
      }
    }
    const color = parse(style.color);
    const alpha = opacity * (color[3] / 255);
    const foreground = color
      .slice(0, 3)
      .map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha)));
    const luminance = (channels) => {
      const [red, green, blue] = channels.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const light = luminance(background);
    const dark = luminance(foreground);
    return { opacity, contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05) };
  });
}

async function setup(page, role = "administrator") {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.roles["member-a"] = role;
  fixture.liveRows = [liveRow("HEADER", 1, REVIEW_COMPANY)];
  fixture.financesRows = [financesRow(1)];
  fixture.kioskRows = [kioskRow(1, "12")];
  fixture.skuConfigurationItems = [item("HEADER-SKU", { company_id: REVIEW_COMPANY })];
  await mockInventory(page, [
    inventoryRow("HEADER-SKU", {
      company_id: REVIEW_COMPANY,
      recommended_action: "GoToRestock",
      recommended_ship_in_units: "10",
    }),
  ]);
  await signIn(page);
}

async function expectContained(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    )
    .toBe(true);
}

for (const role of ["administrator", "member"]) {
  for (const width of [1440, 390]) {
    test(`${role} tabs share a top page title and contextual help at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await setup(page, role);
      const tabs = role === "administrator" ? ADMIN_TABS : MEMBER_TABS;
      await expect(workspaceTabs(page).getByRole("tab")).toHaveText(tabs);
      let firstStyle;
      for (const title of tabs) {
        await workspaceTabs(page).getByRole("tab", { name: title, exact: true }).click();
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        const panel = page.getByRole("tabpanel", { name: title, exact: true });
        const heading = panel.getByRole("heading", { name: title, level: 2, exact: true });
        await expect(heading).toBeVisible();
        await expect(panel.getByRole("heading").first()).toHaveText(title);
        const style = await heading.evaluate((element) => {
          const value = globalThis.getComputedStyle(element);
          return { size: value.fontSize, weight: value.fontWeight, lineHeight: value.lineHeight };
        });
        firstStyle ??= style;
        expect(style).toEqual(firstStyle);
        const button = helpButton(page, title);
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute("aria-expanded", "false");
        const before = await heading.boundingBox();
        await button.click();
        const dialog = helpDialog(page, title);
        await expect(dialog).toBeVisible();
        await expectConciseHelp(dialog, title);
        await expect(button).toHaveAttribute("aria-expanded", "true");
        expect((await dialog.innerText()).length).toBeGreaterThan(30);
        const bounds = await dialog.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(await heading.boundingBox()).toEqual(before);
        await dialog.getByRole("button", { name: `Close ${title} help`, exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(button).toHaveAttribute("aria-expanded", "false");
        await expectContained(page);
      }
      await expect(page.locator(".ui-workspace-intro-description")).toHaveCount(0);
    });
  }
}

test("page help supports hover, keyboard focus, pinning, and dismissal without moving the page", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  const button = helpButton(page, "Transactions");
  const dialog = helpDialog(page, "Transactions");
  await expect(button.locator("svg")).toHaveCSS("width", "16px");
  await expect(button.locator("svg")).toHaveCSS("height", "16px");
  const appearance = await helpIconAppearance(button);
  expect(appearance.opacity).toBeLessThan(1);
  expect(appearance.contrast).toBeGreaterThanOrEqual(3);
  await button.hover();
  await expect(dialog).toBeVisible();
  await expectConciseHelp(dialog, "Transactions");
  await expect(button.locator("svg")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.mouse.move(0, 0);
  await button.hover();
  await expect(dialog).toBeVisible();
  await dialog.hover();
  await expect(dialog).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(dialog).toBeHidden();

  await button.focus();
  await expect(dialog).toBeVisible();
  await expect(button.locator("svg")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close Transactions help", exact: true }),
  ).toBeFocused();
  await page.mouse.move(0, 0);
  await expect(dialog).toBeVisible();
  await expectAccessible("workspace-help-keyboard");
  await page.screenshot({
    path: testInfo.outputPath("workspace-help-desktop.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();

  await button.click();
  await expect(dialog).toBeVisible();
  await workspaceTabs(page).getByRole("tab", { name: "Payout reports", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(helpButton(page, "Payout reports")).toHaveAttribute("aria-expanded", "false");
});

test.describe("touch page help", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("opens on tap, stays readable, and closes without losing its trigger", async ({
    page,
    expectAccessible,
  }, testInfo) => {
    await setup(page, "member");
    await workspaceTabs(page).getByRole("tab", { name: "Inventory", exact: true }).tap();
    const button = helpButton(page, "Inventory");
    const dialog = helpDialog(page, "Inventory");
    const target = await button.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await expect(button.locator("svg")).toHaveCSS("width", "16px");
    await expect(button.locator("svg")).toHaveCSS("height", "16px");
    await button.tap();
    await expect(dialog).toBeVisible();
    await expectConciseHelp(dialog, "Inventory");
    await expectContained(page);
    await expectAccessible("workspace-help-touch");
    await page.screenshot({
      path: testInfo.outputPath("workspace-help-phone.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Close Inventory help", exact: true }).tap();
    await expect(dialog).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.tap();
    await expect(dialog).toBeVisible();
    await page.getByRole("heading", { name: "Inventory", exact: true, level: 2 }).tap();
    await expect(dialog).toBeHidden();
  });
});
