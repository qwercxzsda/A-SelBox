import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  setupFinancialReview,
  setupManyFinancialReviewRows,
} from "./financial-review-fixtures.mjs";

test.use({ viewport: { width: 1440, height: 900 } });

const monthly = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const saved = (page) => page.getByRole("dialog", { name: "Saved source details", exact: true });

function documentState(page) {
  return page.evaluate(() => {
    const root = globalThis.document.documentElement;
    const active = globalThis.document.activeElement;
    return {
      scrollY: globalThis.scrollY,
      scrollHeight: root.scrollHeight,
      viewportHeight: globalThis.innerHeight,
      documentHasFocus: globalThis.document.hasFocus(),
      bodyFocused: active === globalThis.document.body,
      activeTag: active?.tagName ?? null,
      activeLabel: active?.getAttribute("aria-label") ?? null,
      activeElementConnected: active?.isConnected ?? false,
      activeInDrawer: Boolean(active?.closest(".ui-drawer-content")),
      documentOverflow: globalThis.getComputedStyle(root).overflowY,
      bodyOverflow: globalThis.getComputedStyle(globalThis.document.body).overflowY,
      dialogs: [...globalThis.document.querySelectorAll('[role="dialog"]')].map((element) => ({
        label: element.getAttribute("aria-label"),
        display: globalThis.getComputedStyle(element).display,
        visibility: globalThis.getComputedStyle(element).visibility,
        rects: element.getClientRects().length,
      })),
    };
  });
}

async function expectPageWheelScroll(page) {
  const state = await documentState(page);
  const remaining = state.scrollHeight - state.viewportHeight - state.scrollY;
  expect(remaining, "The long fixture must leave room to scroll the document").toBeGreaterThan(600);
  // Leave the pointer where closing placed it. Moving/hovering or clicking the
  // page could mask Safari's need for another window click before scrolling.
  await test.info().attach(`wheel-focus-${test.info().attachments.length + 1}`, {
    body: JSON.stringify(state, null, 2),
    contentType: "application/json",
  });
  await expect
    .poll(
      async () => {
        // Repeat native gestures while the close animation finishes. Programmatic
        // scrollTo would bypass the user's blocked-wheel failure.
        await page.mouse.wheel(0, 240);
        return page.evaluate(() => globalThis.scrollY);
      },
      { message: "Native wheel scrolling should move the underlying document" },
    )
    .toBeGreaterThan(state.scrollY + 100);
  await expect
    .poll(async () => {
      const state = await documentState(page);
      return {
        documentHasFocus: state.documentHasFocus,
        activeElementConnected: state.activeElementConnected,
        activeInDrawer: state.activeInDrawer,
      };
    })
    .toEqual({
      documentHasFocus: true,
      activeElementConnected: true,
      activeInDrawer: false,
    });
}

async function openLongReview(page) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  setupManyFinancialReviewRows(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByRole("combobox", { name: "Rows", exact: true }).selectOption("100");
  await expect(
    page.getByRole("table", { name: "Monthly financial review", exact: true }).locator("tbody tr"),
  ).toHaveCount(100);
  // Confirm the same native gesture works before any drawer is opened.
  await page.mouse.move(12, 800);
  await expectPageWheelScroll(page);
}

async function openMonth(page, month = "July 2026") {
  await page.getByRole("button", { name: `Open review for ${month}`, exact: true }).click();
  await expect(
    monthly(page).getByRole("heading", { name: month, exact: true }).first(),
  ).toBeVisible();
}

async function closeMonth(page, method = "button") {
  if (method === "escape") await page.keyboard.press("Escape");
  else if (method === "backdrop") {
    const bounds = await monthly(page).boundingBox();
    expect(bounds?.x, "A wider desktop must expose the real backdrop").toBeGreaterThan(100);
    await page.mouse.click(24, 300);
  } else
    await monthly(page)
      .getByRole("button", { name: "Close monthly financial review", exact: true })
      .click();
  await expect(monthly(page)).toBeHidden();
}

test("X restores month focus and native scrolling, including a restored drawer after reload", async ({
  page,
}) => {
  await openLongReview(page);
  const opener = page.getByRole("button", {
    name: "Open review for July 2026",
    exact: true,
  });
  await openMonth(page);
  await closeMonth(page);
  await expect(opener).toBeFocused();
  await expectPageWheelScroll(page);

  await openMonth(page);
  await page.reload();
  await expect(
    monthly(page).getByRole("heading", { name: "July 2026", exact: true }).first(),
  ).toBeVisible();
  await closeMonth(page);
  await expect(page.locator(".financial-review-months")).toBeFocused();
  await expectPageWheelScroll(page);
});

test("reopening monthly review preserves native scrolling after X, Escape, and backdrop", async ({
  page,
}) => {
  await openLongReview(page);
  for (const method of ["button", "escape", "backdrop", "button", "escape"]) {
    // The drawer fills the 1440px baseline; expose a real backdrop on a wider desktop.
    if (method === "backdrop") await page.setViewportSize({ width: 1920, height: 900 });
    await openMonth(page);
    if (method === "escape") {
      await monthly(page)
        .getByRole("navigation", { name: "Review months on this page", exact: true })
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(
        monthly(page).getByRole("heading", { name: "June 2026", exact: true }).first(),
      ).toBeVisible();
    }
    await closeMonth(page, method);
    await expect(
      page.getByRole("button", { name: "Open review for July 2026", exact: true }),
    ).toBeFocused();
    await expectPageWheelScroll(page);
    if (method === "backdrop") await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("closing nested saved details and their month restores native page scrolling", async ({
  page,
}) => {
  await openLongReview(page);
  for (const method of ["button", "escape"]) {
    await openMonth(page, "June 2026");
    await monthly(page).getByLabel("Review currency", { exact: true }).selectOption("USD");
    const snapshots = monthly(page).getByRole("button", {
      name: "Saved report snapshots",
      exact: true,
    });
    if ((await snapshots.getAttribute("aria-expanded")) !== "true") await snapshots.click();
    const report = monthly(page)
      .getByRole("table", { name: "Financial records", exact: true })
      .locator("tbody tr.inspectable-row")
      .first();
    await report.click();
    await expect(saved(page)).toBeVisible();
    if (method === "escape") await page.keyboard.press("Escape");
    else await saved(page).getByRole("button", { name: "Close row details", exact: true }).click();
    await expect(saved(page)).toBeHidden();
    await expect(monthly(page)).toBeVisible();
    await expect(report).toBeFocused();
    const backgroundPosition = await page.evaluate(() => globalThis.scrollY);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(150);
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(backgroundPosition);
    await closeMonth(page, method);
    await expect(
      page.getByRole("button", { name: "Open review for June 2026", exact: true }),
    ).toBeFocused();
    await expectPageWheelScroll(page);
  }
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("document-scroll-state", {
    body: JSON.stringify(await documentState(page), null, 2),
    contentType: "application/json",
  });
});
