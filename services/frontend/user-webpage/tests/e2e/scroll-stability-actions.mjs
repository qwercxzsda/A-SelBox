import { expect } from "@playwright/test";
import { deferred } from "./fixtures.mjs";

/** The viewports every scroll-stability case runs at: desktop, phone and a short desktop. */
export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 1440, height: 600 },
];

export const viewportName = ({ width, height }) => `${String(width)}x${String(height)}`;

const REST = "/rest/v1/";
const ROW_REQUESTS = {
  live: (path, request) =>
    path === `${REST}rpc/transaction_page` && request.postDataJSON().p_limit !== 1,
  finances: (path) => path === `${REST}rpc/source_transaction_page`,
  payouts: (path) => path === `${REST}latest_company_payout_reports`,
  accounts: (path) => path === `${REST}rpc/account_directory`,
  ad_invoices: (path) => path === `${REST}current_ad_invoices`,
  storage: (path) => path === `${REST}current_storage_rows`,
  aged_storage: (path) => path === `${REST}current_aged_storage_rows`,
  removal_orders: (path) => path === `${REST}current_removal_order_rows`,
  reviewMonths: (path) => path === `${REST}rpc/financial_review_months`,
  reviewRecords: (path) => path === `${REST}rpc/financial_outcome_page`,
};

/** The list on one tab: its frame, its rows, and the toolbar above it. */
export function listOf(page, tableName) {
  const table = page.getByRole("table", { name: tableName, exact: true });
  return {
    page,
    table,
    card: page.locator(".table-card").filter({ has: table }),
    rows: table.locator("tbody tr"),
    toolbar: page.locator(".table-toolbar"),
    heading: table.locator("thead"),
  };
}

/** Hold the row responses of the given datasets on request, so the loading state can be measured. */
export async function holdRows(page, ...datasets) {
  let gate = null;
  await page.route(`https://example.invalid${REST}**`, async (route) => {
    const request = route.request();
    const current = gate;
    const path = new URL(request.url()).pathname;
    if (
      current &&
      !["OPTIONS", "HEAD"].includes(request.method()) &&
      datasets.some((dataset) => ROW_REQUESTS[dataset](path, request))
    )
      await current.promise;
    await route.fallback();
  });
  return {
    hold() {
      gate = deferred();
    },
    release() {
      gate?.resolve();
      gate = null;
    },
  };
}

async function nextFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      }),
  );
}

/**
 * Scroll so `target` starts `y` pixels below the top of the viewport, or at that fraction of the
 * viewport's height when `y` is below 1. Inside a drawer, its scroller moves instead of the page.
 */
export async function placeAt(page, target, y) {
  await target.evaluate((element, offset) => {
    const scrolls = (node) =>
      node.scrollHeight > node.clientHeight &&
      ["auto", "scroll"].includes(globalThis.getComputedStyle(node).overflowY);
    let scroller = element.parentElement;
    while (scroller && scroller !== globalThis.document.body && !scrolls(scroller))
      scroller = scroller.parentElement;
    const top = offset < 1 ? globalThis.innerHeight * offset : offset;
    const distance = element.getBoundingClientRect().top - top;
    if (scroller && scroller !== globalThis.document.body)
      scroller.scrollTo({ top: scroller.scrollTop + distance, behavior: "instant" });
    else globalThis.scrollTo({ top: globalThis.scrollY + distance, behavior: "instant" });
  }, y);
  await nextFrames(page);
}

/**
 * Playwright's click scrolls a partly hidden target; click a visible target in place. Edges cut
 * by a sub-pixel (such as the last tab of a sideways-scrolling tab bar) still count as visible.
 */
export async function clickAt(page, target) {
  await expect(target).toBeInViewport({ ratio: 0.99 });
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** A column heading scrolled into view sideways inside its table, without moving the page. */
async function revealColumn(trigger) {
  await trigger.evaluate((element) => {
    const scroller = element.closest(".table-horizontal-scroll");
    const box = element.getBoundingClientRect();
    const bounds = scroller.getBoundingClientRect();
    if (box.left < bounds.left || box.right > bounds.right)
      scroller.scrollLeft += box.left - bounds.left - 24;
  });
}

export async function openColumnMenu(list, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trigger = list.heading.getByRole("button", {
    name: new RegExp(`^${escaped}(?: \\d+ selected)?$`),
  });
  await revealColumn(trigger);
  await nextFrames(list.page);
  await clickAt(list.page, trigger);
  const menu = list.page.getByRole("dialog", { name: `${label} options`, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** A menu choice scrolled into view inside its menu; the page itself does not scroll. */
export async function menuChoice(page, menu, name) {
  const choice = menu.getByRole("checkbox", { name });
  const scrollY = await page.evaluate(() => globalThis.scrollY);
  await choice.evaluate((element) => {
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
  });
  expect(await page.evaluate(() => globalThis.scrollY)).toBe(scrollY);
  return choice;
}

const top = async (target) => (await target.boundingBox()).y;
/** Results arrive within this time even on a busy test machine. */
const SETTLE = 15_000;

/** Every target is where it was on screen, to the pixel browsers round to. */
async function expectSamePlace(targets, before) {
  const after = await Promise.all(targets.map(top));
  after.forEach((value, index) => {
    expect(Math.abs(value - before[index]), `target ${String(index)} moved`).toBeLessThanOrEqual(1);
  });
}

/**
 * Run an action and require that the list (and any `also` element, such as an open menu)
 * stays where it is on screen: while a held result loads, the previous rows stay dimmed and
 * inactive, and the new result arrives in the same place.
 */
export async function expectListStays(list, { action, rows, held = null, also = [] }) {
  const targets = [list.card, ...also];
  const before = await Promise.all(targets.map(top));
  held?.hold();
  await action();
  if (held) {
    await expect(list.card).toHaveAttribute("data-placeholder", "true");
    await expect(list.card).toHaveAttribute("aria-busy", "true");
    await expect(list.toolbar.locator(".pagination-summary")).toHaveText("Updating…");
    await expectSamePlace(targets, before);
    held.release();
    await expect(list.card).not.toHaveAttribute("data-placeholder", { timeout: SETTLE });
  }
  await expect(list.rows).toHaveCount(rows, { timeout: SETTLE });
  await nextFrames(list.page);
  await expectSamePlace(targets, before);
}

/**
 * Run an action and require that `targets` stay where they are on screen, both while a held
 * response loads and after `settled` resolves.
 */
export async function expectStays(page, targets, { action, settled, held = null }) {
  const before = await Promise.all(targets.map(top));
  held?.hold();
  await action();
  if (held) {
    await nextFrames(page);
    await expectSamePlace(targets, before);
    held.release();
  }
  await settled();
  await nextFrames(page);
  await expectSamePlace(targets, before);
}

/** Space kept for a shorter result goes away as the user scrolls back up. */
export async function expectReserveReleased(page) {
  const reserve = () =>
    page.evaluate(
      () =>
        globalThis.document.querySelector(".scroll-reserve")?.getBoundingClientRect().height ?? 0,
    );
  const kept = await reserve();
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, -200);
  if (kept > 0) await expect.poll(reserve).toBeLessThan(kept);
  await page.evaluate(() => {
    globalThis.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect.poll(reserve).toBe(0);
}
