import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";

const previousReport = "0198b50b-701a-7000-8000-000000000043";

for (const width of [390, 1440]) {
  test(`closing a restored historical snapshot reveals its report controls at ${width}px without changing ordinary opener return`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFinancialReview(page, (fixture) => {
      fixture.payoutRows.push({
        ...fixture.payoutRows[0],
        id: previousReport,
        created_at: "2026-09-26T13:20:10Z",
      });
      fixture.payoutRecords.push(
        ...fixture.payoutRecords.map((row) => ({
          ...row,
          report_id: previousReport,
        })),
      );
    });
    await page.getByRole("button", { name: "Open review for June 2026", exact: true }).click();
    const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    await monthly.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
    const snapshots = monthly.getByRole("region", { name: "Saved report snapshots", exact: true });
    await snapshots.getByRole("button", { name: /^Show versions for/ }).click();
    const opener = snapshots.locator(".payout-version-row[data-version='previous']");
    await opener.focus();
    const originalScroll = await monthly.evaluate((element) => element.scrollTop);
    await opener.press("Enter");
    const saved = page.getByRole("dialog", { name: "Saved report source details", exact: true });
    await expect(
      saved.getByRole("table", { name: "Supporting payout records", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await expect
      .poll(() => monthly.evaluate((element) => element.scrollTop))
      .toBeCloseTo(originalScroll, 0);

    await opener.press("Enter");
    await expect(saved).toBeVisible();
    await page.reload();
    await expect(
      saved.getByRole("table", { name: "Supporting payout records", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("report")).toBe(previousReport);
    await page.keyboard.press("Escape");
    const controls = snapshots.getByRole("group", { name: "Payout report controls", exact: true });
    await expect(controls).toBeFocused();
    await expectFullyInViewport(controls);
    await expect(monthly.locator(".detail-drawer-context")).toHaveText(
      "June 2026 · Amazon.com · USD · Data Kiosk category · All companies",
    );
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
}
