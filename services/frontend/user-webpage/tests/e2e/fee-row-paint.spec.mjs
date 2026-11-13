import { expect, test } from "@playwright/test";
import { feeGroup, item, period, setup } from "./sku-configuration-fixtures.mjs";

async function observeFold(page, button, keyboard = false) {
  await page.evaluate(() => {
    const group = globalThis.document.querySelector('[data-sku="S1"]');
    const toggle = group.querySelector(".table-disclosure");
    const expectedBorder = globalThis.getComputedStyle(group.querySelector("td")).borderBottomColor;
    globalThis.feePaintFrames = new Promise((resolve) => {
      toggle.addEventListener(
        "click",
        () => {
          const start = globalThis.performance.now();
          const frames = [];
          function sample() {
            const row = group.querySelector("tr");
            const style = globalThis.getComputedStyle(row);
            frames.push({
              border: style.borderBottomColor,
              borderWidth: style.borderBottomWidth,
              borderStyle: style.borderBottomStyle,
              opacity: style.opacity,
              cellsOpaque: [...row.children].every(
                (cell) => globalThis.getComputedStyle(cell).opacity === "1",
              ),
              borderAnimating: row
                .getAnimations()
                .some((animation) => animation.transitionProperty === "border-bottom-color"),
            });
            if (globalThis.performance.now() - start < 200)
              globalThis.requestAnimationFrame(sample);
            else resolve({ expectedBorder, frames });
          }
          sample();
        },
        { capture: true, once: true },
      );
    });
  });
  if (keyboard) await button.press("Enter");
  else await button.click();
  return page.evaluate(() => globalThis.feePaintFrames);
}

for (const width of [1440, 390]) {
  test(`fee folding reveals its first separator without a color flash at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, "administrator", [
      item("S1", {
        periods: [
          period("5", "2026-09-01", "2026-09-10"),
          period("7", "2026-09-10"),
          { ...period("0"), marketplace_name: "Amazon.co.jp" },
        ],
      }),
    ]);
    const group = feeGroup(page, "S1");
    const toggle = group.getByRole("button", { name: /^(Show|Hide) fee periods for S1$/ });
    await toggle.hover();
    for (const keyboard of [false, true]) {
      const expanding = (await toggle.getAttribute("aria-expanded")) === "false";
      const { expectedBorder, frames } = await observeFold(page, toggle, keyboard);
      expect(frames.length).toBeGreaterThan(1);
      for (const frame of frames) {
        expect(frame.border).toBe(expectedBorder);
        expect(frame.borderAnimating).toBe(false);
        expect(frame.opacity).toBe("1");
        expect(frame.cellsOpaque).toBe(true);
      }
      expect(frames.at(-1)).toMatchObject({
        borderWidth: expanding ? "1px" : "0px",
        borderStyle: expanding ? "solid" : "none",
      });
      await expect(toggle).toHaveAttribute("aria-expanded", String(expanding));
      await expect(group.locator("tr")).toHaveCount(expanding ? 3 : 1);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
}
