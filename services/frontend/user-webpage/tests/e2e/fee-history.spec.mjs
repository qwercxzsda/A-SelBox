import { expect, test } from "@playwright/test";
import { createReplies } from "./mocks/http.mjs";
import {
  COMPANY,
  OTHER_COMPANY,
  item,
  period,
  setup,
  version,
  feeRow,
  feeDetails,
  editor,
  toggleFeePeriods,
  openEditor,
} from "./sku-configuration-fixtures.mjs";

const SKU_ID = version(1);
const currentVersion = version(112);
const VERSION_COLUMNS = [
  "id",
  "sku_id",
  "company_id",
  "version_number",
  "change_reason",
  "fee_period_count",
  "created_at",
];
const PERIOD_COLUMNS = [
  "id",
  "terms_version_id",
  "marketplace_name",
  "valid_period",
  "fee_rate_percent",
];

async function historyFixture(page, role = "administrator") {
  const fixture = await setup(page, role, [
    item("S1", {
      terms_version_id: currentVersion,
      periods: [period("5", "2026-09-01", "2026-10-01")],
    }),
  ]);
  const history = { requests: [], status: 200 };
  const versions = Array.from({ length: 12 }, (_, index) => {
    const number = 12 - index;
    return {
      id: version(100 + number),
      sku_id: SKU_ID,
      company_id: number === 12 ? COMPANY : OTHER_COMPANY,
      version_number: String(number),
      change_reason: `Saved reason ${number}`,
      fee_period_count: String(number === 1 ? 0 : number === 11 ? 2 : 1),
      created_at: `2026-09-${String(number).padStart(2, "0")}T12:30:00+00:00`,
    };
  });
  const periods = versions.flatMap((saved) =>
    Array.from({ length: Number(saved.fee_period_count) }, (_, index) => ({
      id: version(1000 + Number(saved.version_number) * 10 + index),
      terms_version_id: saved.id,
      marketplace_name: index === 1 ? "Amazon.co.uk" : "Amazon.com",
      valid_period: index === 1 ? "[2026-09-01,)" : "[2026-09-01,2026-10-01)",
      fee_rate_percent: saved.version_number === "11" ? (index === 0 ? "0" : "6.123456") : "5",
    })),
  );
  for (const endpoint of ["sku_terms_versions", "sku_fee_periods"]) {
    await page.route(`https://example.invalid/rest/v1/${endpoint}?**`, async (route) => {
      const { reply, csvReply } = createReplies(route);
      if (route.request().method() === "OPTIONS") return reply({});
      const url = new URL(route.request().url());
      history.requests.push({ endpoint, params: url.searchParams });
      if (history.status !== 200) return reply({}, history.status);
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      if (endpoint === "sku_terms_versions") {
        expect(url.searchParams.get("sku_id")).toBe(`eq.${SKU_ID}`);
        return csvReply(
          VERSION_COLUMNS,
          versions.slice(offset, offset + limit),
          versions.length,
          offset,
        );
      }
      const ids = url.searchParams.get("terms_version_id").slice(4, -1).split(",");
      const matching = periods.filter((row) => ids.includes(row.terms_version_id));
      return csvReply(
        PERIOD_COLUMNS,
        matching.slice(offset, offset + limit),
        matching.length,
        offset,
      );
    });
  }
  return { fixture, history };
}

for (const width of [1440, 390]) {
  test(`saved fee versions retain complete historical schedules and page independently at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const { fixture, history } = await historyFixture(page);
    await toggleFeePeriods(page, "S1");
    expect(history.requests).toHaveLength(0);
    await feeRow(page, "S1").press("Enter");
    const saved = feeDetails(page).getByRole("region", {
      name: "Marketplace fee periods",
      exact: true,
    });
    await expect(
      feeDetails(page).getByRole("heading", { name: "Saved versions", exact: true }),
    ).toHaveCount(0);
    await expect(
      feeDetails(page).getByRole("heading", { name: "Marketplace fee periods", exact: true }),
    ).toHaveCount(1);
    await expect(saved.getByRole("article")).toHaveCount(10);
    const current = saved.getByRole("article", { name: "Saved fee version 12", exact: true });
    await expect(current).toContainText("Current");
    await expect(
      current.getByRole("table", { name: "Marketplace fees for S1", exact: true }),
    ).toContainText("5%");
    await expect(
      feeDetails(page).getByRole("table", { name: "Marketplace fees for S1", exact: true }),
    ).toHaveCount(1);
    await expect(feeDetails(page).getByText(/shown above/)).toHaveCount(0);
    await expect(feeDetails(page).locator(".detail-section").last()).toHaveAttribute(
      "aria-label",
      "Additional details",
    );
    const previous = saved.getByRole("article", { name: "Saved fee version 11", exact: true });
    await expect(previous).toContainText("Beta Company");
    await expect(previous).toContainText("Saved reason 11");
    await expect(previous).toContainText("2026-09-11 12:30:00 UTC");
    const table = previous.getByRole("table", {
      name: "Marketplace fees for S1 · version 11",
      exact: true,
    });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByRole("cell", { name: "0%", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "6.123456%", exact: true })).toBeVisible();
    await expect(table).toContainText("2026-10-01 (exclusive)");
    await expect(table).toContainText("No end date");
    await expect(saved.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await previous.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`saved-fee-versions-${width}.png`),
      animations: "disabled",
    });
    await saved.getByRole("button", { name: "Next saved versions", exact: true }).click();
    await expect(saved.getByRole("article")).toHaveCount(2);
    await expect(
      saved.getByRole("article", { name: "Saved fee version 2", exact: true }),
    ).toBeVisible();
    await expect(
      saved.getByRole("article", { name: "Saved fee version 1", exact: true }),
    ).toContainText("No marketplace fee periods are available for this SKU.");
    await expect(
      saved.getByRole("button", { name: "Next saved versions", exact: true }),
    ).toBeDisabled();
    await feeDetails(page).getByRole("button", { name: "Additional details", exact: true }).click();
    const metadata = feeDetails(page).getByRole("table", {
      name: "Additional fee details",
      exact: true,
    });
    await expect(metadata).toBeVisible();
    await expect(metadata.getByRole("cell", { name: currentVersion, exact: true })).toBeVisible();
    await metadata.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`merged-fee-metadata-${width}.png`),
      animations: "disabled",
    });
    await page.reload();
    await expect(
      feeDetails(page).getByRole("article", { name: "Saved fee version 1", exact: true }),
    ).toBeVisible();
    await feeDetails(page).getByRole("button", { name: "Edit S1", exact: true }).click();
    await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("5");
    await expect(editor(page).getByRole("combobox", { name: "Company", exact: true })).toHaveValue(
      COMPANY,
    );
    expect(fixture.configurationSaves).toHaveLength(0);
  });
}

test("a failed historical read preserves the current configuration and supports an explicit retry", async ({
  page,
}) => {
  const { fixture, history } = await historyFixture(page);
  history.status = 403;
  await feeRow(page, "S1").press("Enter");
  const saved = feeDetails(page).getByRole("region", {
    name: "Marketplace fee periods",
    exact: true,
  });
  await expect(saved.getByRole("alert")).toContainText("Could not load saved fee versions");
  await expect(
    feeDetails(page).getByRole("table", { name: "Marketplace fees for S1", exact: true }),
  ).toContainText("5%");
  await expect(
    feeDetails(page).getByRole("button", { name: "Edit S1", exact: true }),
  ).toBeEnabled();
  history.status = 200;
  await saved.getByRole("button", { name: "Retry saved versions", exact: true }).click();
  await expect(saved.getByRole("article")).toHaveCount(10);
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("staged changes remain distinct from every published fee version", async ({ page }) => {
  const { fixture } = await historyFixture(page);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.5");
  await editor(page)
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption(OTHER_COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await feeRow(page, "S1").press("Enter");
  await expect(
    feeDetails(page).getByRole("table", { name: "Marketplace fees for S1", exact: true }),
  ).toContainText("6.5%");
  const draft = feeDetails(page)
    .getByRole("article")
    .filter({
      has: page.getByRole("table", { name: "Marketplace fees for S1", exact: true }),
    });
  await expect(draft).toContainText("Draft");
  await expect(draft).toContainText("Beta Company");
  await expect(
    feeDetails(page).getByRole("heading", { name: "Marketplace fee periods", exact: true }),
  ).toHaveCount(1);
  await expect(feeDetails(page).locator(".detail-section").last()).toHaveAttribute(
    "aria-label",
    "Additional details",
  );
  const published = feeDetails(page).getByRole("article", {
    name: "Saved fee version 12",
    exact: true,
  });
  await expect(published).toContainText("Alpha Company");
  await expect(
    published.getByRole("table", { name: "Marketplace fees for S1 · version 12", exact: true }),
  ).toContainText("5%");
  await expect(published).not.toContainText("6.5%");
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("members do not fetch administrator-only assignment history", async ({ page }) => {
  const { history } = await historyFixture(page, "member");
  await feeRow(page, "S1").press("Enter");
  await expect(
    feeDetails(page).getByRole("table", { name: "Marketplace fees for S1", exact: true }),
  ).toBeVisible();
  await expect(
    feeDetails(page).getByRole("region", { name: "Marketplace fee periods", exact: true }),
  ).toBeVisible();
  await expect(feeDetails(page).getByRole("article", { name: /^Saved fee version/ })).toHaveCount(
    0,
  );
  expect(history.requests).toHaveLength(0);
});
