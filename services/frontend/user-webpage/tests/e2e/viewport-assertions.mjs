import { expect } from "@playwright/test";

export async function expectFullyInViewport(locator) {
  await expect(locator).toBeVisible();
  // Browsers may round a fractional overflow boundary by less than one CSS pixel.
  await expect
    .poll(
      () =>
        locator.evaluate(
          (element) =>
            new Promise((resolve) => {
              const observer = new globalThis.IntersectionObserver(([entry]) => {
                observer.disconnect();
                const bounds = entry.boundingClientRect;
                const visible = entry.intersectionRect;
                resolve(
                  entry.isIntersecting
                    ? Math.max(
                        0,
                        visible.left - bounds.left,
                        visible.top - bounds.top,
                        bounds.right - visible.right,
                        bounds.bottom - visible.bottom,
                      )
                    : Number.POSITIVE_INFINITY,
                );
              });
              observer.observe(element);
            }),
        ),
      { message: "Every element edge should fit inside the viewport and clipping ancestors" },
    )
    .toBeLessThanOrEqual(1);
}
