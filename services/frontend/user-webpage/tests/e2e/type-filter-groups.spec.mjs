import { expect, test } from "@playwright/test";
import registry from "../../src/generated/transaction-types.json" with { type: "json" };
import { mockSupabase, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

const STORAGE = "Storage & inventory";
const EPR_TYPES = registry
  .filter(({ type }) => type.includes("EPR Pay on Behalf"))
  .map(({ type }) => type);
const sorted = (values) => [...values].sort();
const typesSent = (fixture) => fixture.requests.at(-1)?.args?.p_types ?? [];
const search = (menu) => menu.getByLabel("Search type", { exact: true });
const checkbox = (menu, name) => menu.getByRole("checkbox", { name, exact: true });
const typeChip = (page) => page.getByRole("button", { name: /^Clear type filter:/ });

async function start(page, role = "operator") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  await signIn(page);
  return fixture;
}

async function expectTypes(fixture, expected) {
  await expect.poll(() => sorted(typesSent(fixture))).toEqual(sorted(expected));
}

for (const role of ["company_member", "operator"]) {
  test(`${role} type groups retain exact role and dataset scopes without option API requests`, async ({
    page,
  }) => {
    const fixture = await start(page, role);
    const optionRequests = fixture.optionRequests.length;
    const menu = await openColumn(page, "Type");
    await expect(checkbox(menu, STORAGE)).toBeVisible();
    await expect(checkbox(menu, "FBA storage fee")).toHaveCount(0);
    await checkbox(menu, STORAGE).check();
    await expect.poll(() => typesSent(fixture)).toContain("FBA_STORAGE_FEE");
    expect(typesSent(fixture)).toContain("FBAFees/FBA Inventory Storage Fee/Base fee");
    const allowed = new Set(
      registry
        .filter(({ category }) => role === "operator" || category !== "SELBOX")
        .map(({ type }) => type),
    );
    expect(typesSent(fixture).every((value) => allowed.has(value))).toBe(true);

    await search(menu).fill("subscription");
    await expect(checkbox(menu, "Subscription fee")).toHaveCount(role === "operator" ? 1 : 0);
    await search(menu).fill("SETTLEMENT_KIOSK_DIFFERENCE");
    await expect(checkbox(menu, "Settlement / Data Kiosk difference")).toHaveCount(
      role === "operator" ? 1 : 0,
    );
    await menu.getByRole("button", { name: "Done", exact: true }).click();

    if (role === "operator") {
      for (const [tab, source] of [
        ["Settlements", "SETTLEMENT"],
        ["Data Kiosk", "DATA_KIOSK"],
      ]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const sourceMenu = await openColumn(page, "Type");
        await checkbox(sourceMenu, STORAGE).check();
        const expectedType =
          source === "SETTLEMENT"
            ? "FBAFees/FBA Inventory Storage Fee/Base fee"
            : "FBA_STORAGE_FEE";
        await expect.poll(() => typesSent(fixture)).toContain(expectedType);
        const allowedSource = new Set(
          registry.filter((entry) => entry.source === source).map(({ type }) => type),
        );
        expect(typesSent(fixture).length).toBeGreaterThan(1);
        expect(typesSent(fixture).every((value) => allowedSource.has(value))).toBe(true);
        await sourceMenu.getByRole("button", { name: "Done", exact: true }).click();
      }
    }
    expect(fixture.optionRequests).toHaveLength(optionRequests);
  });
}

test("a full group has a readable chip, reloads, and becomes partial after an exact type is removed", async ({
  page,
}) => {
  const fixture = await start(page);
  let menu = await openColumn(page, "Type");
  await checkbox(menu, STORAGE).check();
  await expect.poll(() => typesSent(fixture)).toContain("FBA_STORAGE_FEE");
  const fullGroup = [...typesSent(fixture)];
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  await expect(typeChip(page)).toContainText(`Type: ${STORAGE}`);
  await page.reload();
  await expect(typeChip(page)).toContainText(`Type: ${STORAGE}`);
  await expectTypes(fixture, fullGroup);
  menu = await openColumn(page, "Type");
  await expect(checkbox(menu, STORAGE)).toBeChecked();
  await expect(checkbox(menu, "FBA storage fee")).toBeChecked();
  await checkbox(menu, "FBA storage fee").uncheck();
  await expect(checkbox(menu, STORAGE)).toBeChecked({ indeterminate: true });
  await expectTypes(
    fixture,
    fullGroup.filter((type) => type !== "FBA_STORAGE_FEE"),
  );
  await checkbox(menu, STORAGE).check();
  await expect(checkbox(menu, "FBA storage fee")).toBeChecked();
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  // The previous selection is cached; F5 verifies its persisted exact API keys.
  await page.reload();
  await expect(typeChip(page)).toContainText(`Type: ${STORAGE}`);
  await expectTypes(fixture, fullGroup);
  menu = await openColumn(page, "Type");
  await menu.getByRole("button", { name: "Clear type", exact: true }).click();
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  await expect(typeChip(page)).toHaveCount(0);
  await page.reload();
  await expectTypes(fixture, []);
});

test("search and batch actions select only matching exact types and preserve unrelated selections", async ({
  page,
}) => {
  const fixture = await start(page);
  const menu = await openColumn(page, "Type");
  await search(menu).fill("product sales");
  await checkbox(menu, "Product sales").check();
  await expectTypes(fixture, ["PRODUCT_SALES"]);

  await search(menu).fill("EPR GB");
  await menu.getByRole("button", { name: "Select matches", exact: true }).click();
  await expectTypes(fixture, ["PRODUCT_SALES", ...EPR_TYPES]);
  await search(menu).fill("packaging EPR");
  await menu.getByRole("button", { name: "Deselect matches", exact: true }).click();
  await expectTypes(fixture, [
    "PRODUCT_SALES",
    ...EPR_TYPES.filter((type) => !type.includes("Packaging")),
  ]);

  await search(menu).fill("storage fee");
  await expect(checkbox(menu, "FBA storage fee")).toBeVisible();
  await expect(checkbox(menu, "Disposal fee")).toHaveCount(0);
  await search(menu).fill("FBA_STORAGE_FEE");
  await checkbox(menu, STORAGE).check();
  await expectTypes(fixture, [
    "PRODUCT_SALES",
    "FBA_STORAGE_FEE",
    ...EPR_TYPES.filter((type) => !type.includes("Packaging")),
  ]);
  await checkbox(menu, STORAGE).uncheck();
  await expect(checkbox(menu, "FBA storage fee")).not.toBeChecked();
  await expect(menu.getByText("2 types selected", { exact: true })).toBeVisible();
  await search(menu).fill("NO SUCH TYPE");
  await expect(menu.getByText("No matching types.", { exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Select matches", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expectTypes(fixture, [
    "PRODUCT_SALES",
    ...EPR_TYPES.filter((type) => !type.includes("Packaging")),
  ]);
});

test("type groups support keyboard selection, disclosure, and escape focus return", async ({
  page,
}) => {
  const fixture = await start(page);
  const trigger = page.getByRole("button", { name: "Type", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Type options", exact: true });
  await expect(search(menu)).toBeFocused();
  const group = checkbox(menu, STORAGE);
  await group.focus();
  await page.keyboard.press("Space");
  await expect(group).toBeChecked();
  await expect.poll(() => typesSent(fixture)).toContain("FBA_STORAGE_FEE");
  const disclosure = menu.getByRole("button", {
    name: `Show individual types in ${STORAGE}`,
    exact: true,
  });
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(checkbox(menu, "FBA storage fee")).toBeVisible();
  await expect(
    menu.getByRole("button", { name: `Hide individual types in ${STORAGE}`, exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("an open type filter stays entirely visible while resizing after restored group selections", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page);
  let menu = await openColumn(page, "Type");
  await checkbox(menu, STORAGE).check();
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(typeChip(page)).toContainText(`Type: ${STORAGE}`);
  menu = await openColumn(page, "Type");
  await expect(checkbox(menu, "FBA storage fee")).toBeChecked();

  for (const [state, query] of [
    ["restored-group", ""],
    ["long-raw-types", "AmazonFees/ Packaging"],
  ]) {
    await search(menu).fill(query);
    for (const width of [834, 390, 834, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      // Read geometry before any locator action can scroll the detached header into view.
      for (const element of [menu, menu.getByRole("button", { name: "Done", exact: true })]) {
        await expect
          .poll(async () => {
            const bounds = await element.boundingBox();
            return Boolean(
              bounds &&
              bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= width + 1 &&
              bounds.y + bounds.height <= 1001,
            );
          })
          .toBe(true);
      }
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (width === 390) {
        await page.screenshot({
          path: testInfo.outputPath(`type-resized-${state}-390.png`),
          animations: "disabled",
        });
      }
    }
  }
});

for (const width of [1440, 834, 390]) {
  test(`type groups and long fee matches fit the viewport at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await start(page);
    const menu = await openColumn(page, "Type");
    for (const [state, query] of [
      ["groups", ""],
      ["epr-matches", "GB packaging"],
    ]) {
      await search(menu).fill(query);
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await expect(menu.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`type-${state}-${width}.png`),
        animations: "disabled",
      });
    }
  });
}
