import { expect } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

export const COMPANY = "00000000-0000-4000-8000-000000000101";
export const OTHER_COMPANY = "00000000-0000-4000-8000-000000000102";
export const version = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const period = (rate = "5", from = "2026-09-01", to = null) => ({
  marketplace_name: "Amazon.com",
  valid_from: from,
  valid_to: to,
  fee_rate_percent: rate,
});
export const item = (sku, overrides = {}) => ({
  sku,
  sku_id: version(sku === "S1" ? 1 : 2),
  company_id: COMPANY,
  terms_version_id: version(sku === "S1" ? 11 : 12),
  periods: [period()],
  requirements: [
    { marketplace_name: "Amazon.com", valid_from: "2026-09-01", valid_to: "2026-09-03" },
  ],
  issues: [],
  ...overrides,
});
export const editor = (page) => page.getByRole("dialog", { name: /^Edit |^Add SKU$/ });
export const review = (page) =>
  page.getByRole("dialog", { name: "Review configuration changes", exact: true });

export async function setup(page, role = "operator", items = [item("S1")], configure = () => {}) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = COMPANY;
  fixture.companyIds["member-b"] = OTHER_COMPANY;
  fixture.companyNames = { [COMPANY]: "Alpha Company", [OTHER_COMPANY]: "Beta Company" };
  fixture.skuConfigurationItems = items;
  fixture.assignments = items
    .filter((row) => row.company_id)
    .map((row) => ({
      id: row.sku_id,
      sku: row.sku,
      company_id: row.company_id,
      terms_version_id: row.terms_version_id,
    }));
  configure(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for S1", exact: true }),
  ).toBeVisible();
  return fixture;
}
export async function openEditor(page, sku = "S1") {
  const toggle = page.getByRole("button", {
    name: `Show marketplace fees for ${sku}`,
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("button", { name: `Edit ${sku}`, exact: true }).click();
  await expect(editor(page)).toBeVisible();
}
export async function stageRate(page, rate = "6") {
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill(rate);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
}
export async function openReview(page) {
  await page.getByRole("button", { name: /^Review changes/ }).click();
  await expect(review(page)).toBeVisible();
}
