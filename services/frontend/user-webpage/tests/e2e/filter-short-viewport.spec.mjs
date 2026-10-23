import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

async function expectUncovered(control) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = globalThis.document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return element.contains(hit);
      }),
    )
    .toBe(true);
}

test("the summary date dialog exposes a named close action and returns keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 256 });
  await mockSupabase(page);
  await signIn(page);
  const opener = page.getByRole("button", { name: "Choose dates", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
  const close = dialog.getByRole("button", { name: "Close summary dates", exact: true });
  await close.focus();
  await expectUncovered(close);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const width of [390, 640]) {
  test(`date error actions remain reachable in a ${width} by 256 viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 256 });
    await mockSupabase(page);
    await signIn(page);
    const menu = await openColumn(page, "Date");
    const from = menu.getByLabel("From date", { exact: true });
    const to = menu.getByLabel("To date", { exact: true });
    const apply = menu.getByRole("button", { name: "Apply dates", exact: true });
    await from.fill("2026-09-30");
    await to.fill("2026-09-01");
    await apply.click();
    await expect(menu.getByRole("alert")).toBeVisible();
    await apply.focus();
    await expectUncovered(apply);
    await page.screenshot({ path: testInfo.outputPath(`date-error-${width}-256.png`) });
    await from.fill("2026-09-01");
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
  });
}

test("type search actions remain reachable above a sticky footer in a short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 256 });
  await mockSupabase(page);
  await signIn(page);
  const menu = await openColumn(page, "Type");
  await menu.getByLabel("Search type", { exact: true }).fill("refund");
  const select = menu.getByRole("button", { name: "Select matches", exact: true });
  await select.focus();
  await expectUncovered(select);
  await page.keyboard.press("Enter");
  const done = menu.getByRole("button", { name: "Done", exact: true });
  await done.focus();
  await expectUncovered(done);
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
});
