import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";
import { preventedBrowserGestures, UNPREVENTED_BROWSER_GESTURES } from "./browser-gestures.mjs";

const button = (parent, name) => parent.getByRole("button", { name, exact: true });
const position = (menu) => menu.evaluate((element) => element.scrollTop);

async function setup(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.skuOptions = Array.from(
    { length: 100 },
    (_, index) => `Collagen Night Wrapping Mask ${String(index + 1).padStart(3, "0")}`,
  );
  await signIn(page);
  return fixture;
}

async function pointAt(page, target) {
  await expect(target).toBeInViewport({ ratio: 1 });
  // A sticky heading/footer can cover an element that is technically in the viewport.
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          globalThis.document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    )
    .toBe(true);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  // Use pointer movement only. Clicking or focusing the list would hide the reported bug.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function wheel(page, deltaY) {
  await page.mouse.wheel(0, deltaY);
  // Wheel is asynchronous. Allow its native default action to reach the next paint.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      }),
  );
}

async function toTop(page, menu) {
  await pointAt(page, menu.getByText(/^(SKU|Type) options$/, { exact: true }));
  await wheel(page, -100_000);
  await expect.poll(() => position(menu)).toBe(0);
}

async function expectBounded(page, menu) {
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      const viewport = page.viewportSize();
      return Boolean(
        box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1,
      );
    })
    .toBe(true);
  await expect(button(menu, "Close options")).toBeInViewport({ ratio: 1 });
}

async function expandTypes(menu) {
  const expanders = menu.getByRole("button", { name: /^Show individual types in / });
  const count = await expanders.count();
  expect(count).toBeGreaterThanOrEqual(8);
  for (let index = 0; index < count; index++) await expanders.first().click();
  await expect(expanders).toHaveCount(0);
  expect(await menu.getByRole("checkbox").count()).toBeGreaterThan(100);
}

async function assertHoverScrolling(page, menu, column) {
  const search = menu.getByLabel(`Search ${column.toLowerCase()}`, { exact: true });
  await search.focus();
  await toTop(page, menu);
  const pageTop = await page.evaluate(() => globalThis.scrollY);
  for (const target of [
    menu.getByText(`${column} options`, { exact: true }),
    menu.getByText(`Search ${column.toLowerCase()}`, { exact: true }),
    search,
    menu.getByRole("checkbox").first().locator(".."),
  ]) {
    await toTop(page, menu);
    await pointAt(page, target);
    await wheel(page, 180);
    await expect.poll(() => position(menu)).toBeGreaterThan(0);
    expect(await page.evaluate(() => globalThis.scrollY)).toBe(pageTop);
    await expect(search).toBeFocused();
  }
  await pointAt(page, menu.getByText(`${column} options`, { exact: true }));
  await wheel(page, 100_000);
  await expect
    .poll(() =>
      menu.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeLessThanOrEqual(1);
  await wheel(page, 500);
  expect(await page.evaluate(() => globalThis.scrollY)).toBe(pageTop);
  await toTop(page, menu);
  await wheel(page, -500);
  expect(await page.evaluate(() => globalThis.scrollY)).toBe(pageTop);
}

for (const column of ["SKU", "Type"]) {
  test(`${column} popup scrolls on hover over its search, heading, and choices without scrolling the page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const menu = await openColumn(page, column);
    if (column === "Type") await expandTypes(menu);
    else await expect(menu.getByRole("checkbox")).toHaveCount(100);
    await expectBounded(page, menu);
    await assertHoverScrolling(page, menu, column);
    expect(await preventedBrowserGestures(menu.locator("input").first())).toEqual(
      UNPREVENTED_BROWSER_GESTURES,
    );
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button(page, column)).toBeFocused();
  });
}

test("page scrolling outside the open popup and viewport changes keep its controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const menu = await openColumn(page, "Type");
  await expandTypes(menu);
  await expectBounded(page, menu);
  const before = await page.evaluate(() => globalThis.scrollY);
  await page.mouse.move(720, 2);
  await wheel(page, 500);
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(before);
  await expectBounded(page, menu);
  const lower = await page.evaluate(() => globalThis.scrollY);
  await page.mouse.move(720, 2);
  await wheel(page, -500);
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeLessThan(lower);
  await expectBounded(page, menu);
  for (const viewport of [
    { width: 834, height: 700 },
    { width: 390, height: 600 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expectBounded(page, menu);
    await expect(button(menu, "Done")).toBeInViewport({ ratio: 1 });
  }
  await button(menu, "Done").click();
  await expect(menu).toBeHidden();
});

test("a short viewport keeps expanded Type choices and Done usable through the same popup scroll", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 520 });
  await setup(page);
  const menu = await openColumn(page, "Type");
  await expandTypes(menu);
  await assertHoverScrolling(page, menu, "Type");
  await expectBounded(page, menu);
  await expect(button(menu, "Done")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("short-viewport-type-menu.png") });
  await button(menu, "Done").click();
  await expect(menu).toBeHidden();
});

test.describe("mouse input on a touch-configured browser", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1440, height: 900 } });
  test("hovered popup accepts wheel without clicking or requiring hover-capability media queries", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright cannot synthesize wheel events in mobile WebKit.",
    );
    await setup(page);
    expect(await page.evaluate(() => globalThis.matchMedia("(hover: hover)").matches)).toBe(false);
    const menu = await openColumn(page, "SKU");
    await assertHoverScrolling(page, menu, "SKU");
    await expectBounded(page, menu);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});
