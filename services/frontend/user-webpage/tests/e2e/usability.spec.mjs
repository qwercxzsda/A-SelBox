import { expect, test } from "@playwright/test";
import { feeRow, skuAssignment, liveRow } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

test("tab roundtrips retain working filters, sorting, pages, and fee expansions until sign-out", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 120;
  fixture.assignments = [skuAssignment(1), skuAssignment(2)];
  fixture.feeRows = [feeRow(0)];
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("Amazon");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("Amazon");
  await page.getByLabel("Rows", { exact: true }).selectOption("50");
  await expect(rowWithSku(page, "ALPHA-050")).toBeVisible();
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Date options", exact: true })
    .getByRole("button", { name: "Oldest first", exact: true })
    .click();
  await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-051")).toBeVisible();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await page.getByLabel("Search SKUs", { exact: true }).fill("GROUP-001");
  const group = page.getByRole("button", {
    name: "Show marketplace fees for GROUP-001",
    exact: true,
  });
  await group.click();
  await expect(page.getByRole("cell", { name: "4.8%", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Amazon");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
  await expect(page.getByRole("form", { name: "Page 2 of 3", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(rowWithSku(page, "ALPHA-051")).toBeVisible();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue("GROUP-001");
  await expect(group).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
  await expect(page.getByRole("form", { name: "Page 1 of 5", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByLabel("Search SKUs", { exact: true })).toHaveValue("");
  await expect(group).toHaveAttribute("aria-expanded", "false");
});

test("typing or leaving a page number does not navigate until Enter, and invalid ranges clamp", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.totalCount = 500;
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const initialRequests = fixture.requests.length;
  const pageNumber = page.getByLabel("Page number", { exact: true });
  await expect(pageNumber).toBeVisible();
  await expect(page.getByRole("button", { name: "Go", exact: true })).toHaveCount(0);
  await pageNumber.fill("1");
  await pageNumber.pressSequentially("2");
  await page.getByLabel("Search", { exact: true }).focus();
  await page.clock.fastForward(500);
  expect(fixture.requests).toHaveLength(initialRequests);
  await expect(page.getByRole("form", { name: "Page 1 of 20", exact: true })).toBeVisible();
  await pageNumber.press("Enter");
  await expect(rowWithSku(page, "ALPHA-276")).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 12 of 20", exact: true })).toBeVisible();
  await expect(pageNumber).toHaveValue("12");
  expect(fixture.requests.at(-1).params.get("offset")).toBe("275");

  const nextRequests = fixture.requests.length;
  await pageNumber.fill("2");
  await pageNumber.press("Escape");
  await expect(pageNumber).toHaveValue("12");
  expect(fixture.requests).toHaveLength(nextRequests);
  await pageNumber.fill("999");
  await pageNumber.press("Enter");
  await expect(rowWithSku(page, "ALPHA-476")).toBeVisible();
  await expect(pageNumber).toHaveValue("20");
  await expect(page.getByRole("form", { name: "Page 20 of 20", exact: true })).toBeVisible();
  await pageNumber.fill("0");
  await pageNumber.press("Enter");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(pageNumber).toHaveValue("1");
});

for (const width of [320, 390]) {
  test(`inline pagination stays in one row at ${width}px and commits only on Enter`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install();
    const fixture = await mockSupabase(page);
    fixture.totalCount = 500;
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Pagination", exact: true });
    await nav.scrollIntoViewIfNeeded();
    const previous = nav.getByRole("button", { name: "Previous", exact: true });
    const current = nav.getByRole("form", { name: "Page 1 of 20", exact: true });
    const next = nav.getByRole("button", { name: "Next", exact: true });
    const controls = [previous, current, next];
    for (const control of controls) await expect(control).toBeInViewport();
    const bounds = await Promise.all(controls.map((control) => control.boundingBox()));
    const centers = bounds.map((box) => box.y + box.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    expect(bounds[0].x).toBeGreaterThanOrEqual(0);
    expect(bounds[0].x + bounds[0].width).toBeLessThanOrEqual(bounds[1].x + 1);
    expect(bounds[1].x + bounds[1].width).toBeLessThanOrEqual(bounds[2].x + 1);
    expect(bounds[2].x + bounds[2].width).toBeLessThanOrEqual(width);
    expect(
      await nav.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    const pageNumber = page.getByLabel("Page number", { exact: true });
    await expect(pageNumber).toBeInViewport();
    await expect(page.getByRole("button", { name: "Go", exact: true })).toHaveCount(0);

    const initialRequests = fixture.requests.length;
    await pageNumber.fill("12");
    await page.getByLabel("Search", { exact: true }).focus();
    await page.clock.fastForward(500);
    expect(fixture.requests).toHaveLength(initialRequests);
    await pageNumber.press("Escape");
    await expect(pageNumber).toHaveValue("1");
    expect(fixture.requests).toHaveLength(initialRequests);
    await expect(current).toBeVisible();

    await pageNumber.fill("12");
    await pageNumber.press("Enter");
    await expect(rowWithSku(page, "ALPHA-276")).toBeVisible();
    await expect(nav.getByRole("form", { name: "Page 12 of 20", exact: true })).toBeInViewport();
    await expect(pageNumber).toBeInViewport();
    await expect(pageNumber).toHaveValue("12");
  });
}

test("an unsuccessful search explains the empty result and offers a clear recovery action", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("DOES-NOT-EXIST");
  await expect(page.getByRole("table", { name: "Financial records" }).getByRole("row")).toHaveCount(
    1,
  );
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  await expect(page.getByText(/No .*available for your company\./)).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  // Clearing may restore a fresh cached page; the next uncached page must omit the search.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  expect(fixture.requests.at(-1).params.get("or")).toBeNull();
});

test("a hundred-row table expands fully and its last row is reached by document scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const fixture = await mockSupabase(page);
  fixture.totalCount = 150;
  await signIn(page);
  await page.getByLabel("Rows", { exact: true }).selectOption("100");
  const lastRow = rowWithSku(page, "ALPHA-100");
  await expect(lastRow).toBeVisible();
  await expect(lastRow).not.toBeInViewport();
  const table = page.getByRole("table", { name: "Financial records" });
  const region = page.getByRole("region", { name: "Financial table", exact: true });
  await expect(region).toHaveAttribute("tabindex", "0");
  await expect(table.getByRole("row")).toHaveCount(101);
  const tableBounds = await table.boundingBox();
  const regionBounds = await region.boundingBox();
  expect(tableBounds.height).toBeGreaterThan(800);
  expect(regionBounds.height).toBeGreaterThanOrEqual(tableBounds.height - 1);
  const scrollState = await region.evaluate((element) => {
    element.scrollTop = 900;
    return {
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(scrollState.scrollTop).toBe(0);
  expect(scrollState.scrollHeight - scrollState.clientHeight).toBeLessThanOrEqual(1);
  await page.evaluate(() =>
    globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight),
  );
  await expect(lastRow).toBeInViewport();
  expect(await page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(0);
  expect(await region.evaluate((element) => element.scrollTop)).toBe(0);
});

test("phone fee details keep rates within the screen and offer collapse and search recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await mockSupabase(page);
  fixture.assignments = [skuAssignment(1)];
  fixture.feeRows = [
    { ...feeRow(0), fee_rate_percent: "5.123456", marketplace_name: "Amazon.co.uk" },
  ];
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  const group = page.getByRole("button", {
    name: "Show marketplace fees for GROUP-001",
    exact: true,
  });
  await group.click();
  const rate = page.getByRole("cell", { name: "5.123456%", exact: true });
  await rate.scrollIntoViewIfNeeded();
  await expect(rate).toBeInViewport();
  const bounds = await rate.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const table = page.getByRole("table", { name: "Marketplace fees for GROUP-001", exact: true });
  const tableBounds = await table.boundingBox();
  expect(tableBounds.x + tableBounds.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("Search SKUs", { exact: true }).fill("NO-SUCH-SKU");
  await expect(page.getByText("No SKUs match your search.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(group).toBeVisible();
});

test("Transactions hides only zero Data Kiosk rows before pagination", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = [
    { ...liveRow("SETTLEMENT-ZERO", 1), source_amount: "0" },
    ...Array.from({ length: 24 }, (_, index) => ({
      ...liveRow("KIOSK-NONZERO", index + 1),
      source: "DATA_KIOSK",
      source_amount: index === 0 ? "-2.5" : "1",
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      ...liveRow("KIOSK-ZERO", index + 1),
      source: "DATA_KIOSK",
      source_amount: "0.0000",
    })),
  ];
  await signIn(page);
  await expect(rowWithSku(page, "SETTLEMENT-ZERO-001")).toBeVisible();
  await expect(rowWithSku(page, "KIOSK-NONZERO-001")).toBeVisible();
  await expect(page.getByText(/KIOSK-ZERO/)).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Financial records" }).getByRole("row")).toHaveCount(
    26,
  );
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  expect(fixture.requests.at(-1).params.get("and")).toBe(
    "(or(source.neq.DATA_KIOSK,source_amount.neq.0))",
  );
});

for (const role of ["company_member", "operator"]) {
  test(`${role} sees company information only where needed for its scope`, async ({ page }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.assignments = [skuAssignment(1)];
    fixture.feeRows = [feeRow(0)];
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(role === "operator" ? 6 : 3);
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Current fees", exact: true })).toBeVisible();
    for (const sourceTab of ["Settlements", "Data Kiosk"]) {
      await expect(page.getByRole("tab", { name: sourceTab, exact: true })).toHaveCount(
        role === "operator" ? 1 : 0,
      );
    }
    const companyName = "Company A";
    const companyColumn = page.getByRole("columnheader", { name: "Company", exact: true });
    await expect(companyColumn).toHaveCount(role === "operator" ? 1 : 0);
    await expect(page.getByRole("columnheader", { name: "Source", exact: true })).toHaveCount(1);
    const header = page.locator("header");
    await expect(header.getByRole("heading")).toHaveCount(0);
    await expect(header.getByText("A-SelBox", { exact: true })).toBeVisible();
    const identityLabel = header.getByText(role === "operator" ? "Administrator" : companyName, {
      exact: true,
    });
    const email = header.getByText("member-a@example.test", { exact: true });
    await expect(identityLabel).toBeVisible();
    await expect(email).toBeVisible();
    const identityBounds = await identityLabel.boundingBox();
    const emailBounds = await email.boundingBox();
    expect(identityBounds.y + identityBounds.height).toBeLessThanOrEqual(emailBounds.y);
    if (role === "company_member") {
      await expect(
        page
          .getByRole("table", { name: "Financial records" })
          .getByText(companyName, { exact: true }),
      ).toHaveCount(0);
    }

    await rowWithSku(page, "ALPHA-001").click();
    const details = page.getByRole("dialog", { name: "Selected row details" });
    await expect(details.getByText("ALPHA-001", { exact: true })).toHaveCount(1);
    await expect(details.getByText("Company", { exact: true })).toHaveCount(
      role === "operator" ? 1 : 0,
    );
    if (role === "company_member") {
      await expect(details.getByText("Additional details", { exact: true })).toHaveCount(0);
      await expect(details.getByText("company id", { exact: true })).toHaveCount(0);
      await expect(details.getByText("company-member-a", { exact: true })).toHaveCount(0);
      await expect(details.getByText(companyName, { exact: true })).toHaveCount(0);
    } else {
      await details.getByText("Additional details", { exact: true }).click();
      await expect(details.getByText(companyName, { exact: true })).toBeVisible();
    }
    await details.getByRole("button", { name: "Close row details", exact: true }).click();

    if (role === "operator") {
      await page.getByRole("tab", { name: "Data Kiosk", exact: true }).click();
      await expect(page.getByRole("columnheader", { name: "Source", exact: true })).toHaveCount(0);
    }

    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    const group = page.getByRole("button", {
      name: "Show marketplace fees for GROUP-001",
      exact: true,
    });
    if (role === "operator") await expect(group).toContainText(companyName);
    else {
      await expect(group).not.toContainText(companyName);
      await expect(page.getByText(companyName, { exact: true })).toHaveCount(1);
    }
  });
}
