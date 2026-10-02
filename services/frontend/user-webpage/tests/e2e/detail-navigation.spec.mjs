import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

const reportId = "0198b50b-701a-7000-8000-000000000082";
const companyId = "0198b50b-701a-7000-8000-000000000001";

async function openReport(page, role) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = companyId;
  fixture.companyNames[companyId] = "Navigation Company";
  fixture.payoutRows = [
    {
      id: reportId,
      company_id: companyId,
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27T13:20:10Z",
      source_amount: "75",
      fee_amount: "0",
      company_amount: "75",
      reconciliation_count: "1",
    },
  ];
  fixture.payoutComponents = Array.from({ length: 75 }, (_, index) => ({
    id: `record-${index}`,
    report_id: reportId,
    authoritative: "true",
    activity_date: "2026-06-30",
    sku: `SKU-${String(index).padStart(3, "0")}`,
    marketplace_name: "Amazon.com",
    source: "SETTLEMENT",
    component_type: "PRODUCT_SALES",
    quantity: "1",
    source_amount: "1",
    fee_amount: "0",
    company_amount: "1",
  }));
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr[tabindex='0']")
    .first()
    .click();
  return fixture;
}

for (const role of ["operator", "company_member"]) {
  for (const width of [1440, 1920]) {
    test(`${role} can navigate long report records from either end at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await openReport(page, role);
      const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
      await expect(
        drawer.getByText("Saved report · Created 2026-09-27 13:20:10 UTC", { exact: true }),
      ).toBeVisible();
      const records = drawer.getByRole("table", { name: "Amount records", exact: true });
      await expect(records.locator("tbody tr")).toHaveCount(50);
      const top = drawer.getByRole("navigation", { name: "Pagination for records", exact: true });
      const bottom = drawer.getByRole("navigation", {
        name: "Pagination for records at bottom",
        exact: true,
      });
      expect((await top.boundingBox()).y).toBeLessThan((await records.boundingBox()).y);
      await expect(bottom).toContainText("Records 1–50 · 75 records");

      // A long record list keeps its column labels without another vertical scroller.
      await records.locator("tbody tr").nth(30).scrollIntoViewIfNeeded();
      const wrapper = drawer.getByRole("region", { name: "Amount records table", exact: true });
      await expect(wrapper).toHaveAttribute("data-fitting", "true");
      await expect(wrapper).toHaveCSS("overflow-y", "visible");
      const header = await drawer.locator(".mantine-Drawer-header").boundingBox();
      const column = await records
        .getByRole("columnheader", { name: "Date", exact: true })
        .boundingBox();
      expect(column.y).toBeCloseTo(header.y + header.height, 0);
      await page.screenshot({
        path: testInfo.outputPath("sticky-record-columns.png"),
        animations: "disabled",
      });

      await bottom.getByRole("button", { name: "Next records at bottom", exact: true }).click();
      await expect(records.locator("tbody tr")).toHaveCount(25);
      await expect(top).toContainText("Page 2 · 75 records");
      await expect(top).toBeInViewport();
      await expect(top.getByRole("button", { name: "Next records", exact: true })).toBeDisabled();
      await page.reload();
      await expect(top).toContainText("Page 2 · 75 records");
      await top.getByRole("button", { name: "Previous records", exact: true }).click();
      await expect(records.locator("tbody tr")).toHaveCount(50);
      if (role === "company_member") {
        await expect(
          drawer.getByRole("button", { name: "Additional details", exact: true }),
        ).toHaveCount(0);
        await expect(
          drawer.getByRole("button", { name: "Reconciliation", exact: true }),
        ).toHaveCount(0);
        expect(
          fixture.events.some(({ endpoint }) => endpoint.endsWith("/payout_report_reconciliation")),
        ).toBe(false);
      }
    });
  }
}

test("narrow report tables retain horizontal keyboard scrolling and one drawer scroll", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page, "company_member");
  const drawer = page.getByRole("dialog", { name: "Selected row details", exact: true });
  const wrapper = drawer.getByRole("region", { name: "Amount records table", exact: true });
  await expect(wrapper).toHaveAttribute("data-fitting", "false");
  await expect(wrapper).toHaveCSS("overflow-x", "auto");
  const sizes = await wrapper.evaluate((element) => ({
    height: element.clientHeight,
    content: element.scrollHeight,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.height + 1);
  await wrapper.focus();
  await wrapper.press("ArrowRight");
  await expect.poll(() => wrapper.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("phone-report-records.png"),
    animations: "disabled",
  });
});
