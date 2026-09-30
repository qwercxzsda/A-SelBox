/** Real-data layout and keyboard checks; screenshots stay in the private output directory. */
/* global window, document, getComputedStyle */
import { expect } from "@playwright/test";

export async function reviewInventoryLayout(page, name) {
  const region = page.getByRole("region", { name: "Inventory items", exact: true });
  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 },
    { name: "small-mobile", width: 320, height: 760 },
  ];
  const results = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await region.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByText("Estimated totals", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Exact SKU", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Inventory marketplace", { exact: true })).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    if (layout.page > layout.viewport + 1) throw new Error("Inventory page overflows viewport");
    const signOutFits = await page
      .getByRole("button", { name: "Sign out", exact: true })
      .evaluate((button) => {
        const label = button.querySelector(".mantine-Button-label");
        return label && label.scrollWidth <= label.clientWidth;
      });
    if (!signOutFits) throw new Error("Sign out label is clipped");
    const contrast = await page.locator(".inventory-panel").evaluate((panel) => {
      const luminance = (rgb) => {
        const channels = rgb
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map((value) => Number(value) / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return channels.reduce(
          (total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
      };
      const hint = panel.querySelector(".mantine-InputWrapper-description");
      const foreground = luminance(getComputedStyle(hint).color);
      const background = luminance(getComputedStyle(document.body).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    if (contrast < 4.5) throw new Error("Inventory helper contrast is too low");
    await page.screenshot({ path: `/evidence/${name}-${viewport.name}.png` });
    const overflow = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
    if (overflow) {
      await expect(region).toHaveAttribute("tabindex", "0");
      await region.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await region
        .getByRole("columnheader", { name: "Recommendation", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        region.getByRole("columnheader", { name: "Recommendation", exact: true }),
      ).toBeInViewport();
      await page.screenshot({ path: `/evidence/${name}-${viewport.name}-right.png` });
    }
    results.push({
      width: viewport.width,
      page_overflow: false,
      keyboard_scroll: overflow,
      sign_out_label_unclipped: true,
      helper_text_contrast: Math.round(contrast * 100) / 100,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await region.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  return results;
}
