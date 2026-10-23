import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function waitForFiniteAnimations(page) {
  await page.evaluate(async () => {
    let stableFrames = 0;
    while (stableFrames < 2) {
      await new Promise(globalThis.requestAnimationFrame);
      const animations = globalThis.document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        );
      if (animations.length) {
        await Promise.allSettled(animations.map((animation) => animation.finished));
        stableFrames = 0;
      } else stableFrames += 1;
    }
  });
}

/** Scan the full exposed page with all default rules, including open dialogs. */
export const test = base.extend({
  expectAccessible: async ({ page }, use, testInfo) => {
    await use(async (name) => {
      // Contrast must be measured after modal/popover opening fades have settled.
      for (const dialog of await page.getByRole("dialog").all())
        await expect(dialog).toHaveCSS("opacity", "1");
      // Background controls can still be transitioning after a dialog is opaque.
      // Wait for those finite effects too, without disabling perpetual progress indicators.
      await waitForFiniteAnimations(page);
      const results = await new AxeBuilder({ page }).analyze();
      const reportPath = testInfo.outputPath(`axe-${name}.json`);
      await writeFile(reportPath, JSON.stringify(results, null, 2));
      await testInfo.attach(`axe-${name}`, {
        path: reportPath,
        contentType: "application/json",
      });
      if (process.env.PLAYWRIGHT_CAPTURE_REVIEW === "1")
        await page.screenshot({
          path: testInfo.outputPath(`axe-${name}.png`),
          fullPage: true,
          animations: "disabled",
        });
      const violations = results.violations.map(({ id, impact, help, helpUrl, nodes }) => ({
        rule: id,
        impact,
        help,
        helpUrl,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      }));
      expect(
        violations,
        `Accessibility violations in ${name}; see the axe JSON attachment`,
      ).toEqual([]);
    });
  },
});

export { expect } from "@playwright/test";
