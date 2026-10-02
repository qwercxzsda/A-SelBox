import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

test("administrator identity preloads the complete SKU catalog in one request including historical and unregistered keys", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.skuOptions = [
    ...Array.from({ length: 1001 }, (_, index) => `REGISTERED-${String(index).padStart(4, "0")}`),
    "UNREGISTERED-IMPORTED",
    "HISTORICAL-ONLY",
  ];
  fixture.assignments = skuAssignments(["REGISTERED-0000"]);
  fixture.liveRows = [{ ...liveRow("IMPORT", 1), sku: "UNREGISTERED-IMPORTED" }];
  const started = deferred();
  const release = deferred();
  fixture.beforeOptions = async () => {
    started.resolve();
    await release.promise;
  };
  const signingIn = signIn(page);
  try {
    await started.promise;
    expect(fixture.requests).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  } finally {
    release.resolve();
  }
  await signingIn;
  expect(fixture.optionRequests).toHaveLength(1);
  expect(fixture.optionRequests[0].args).toEqual({});
  const before = fixture.optionRequests.length;
  const menu = await openColumn(page, "SKU");
  await menu.getByLabel("Search sku", { exact: true }).fill("HISTORICAL");
  await expect(menu.getByRole("checkbox", { name: "HISTORICAL-ONLY", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("unregistered");
  await expect(rowWithSku(page, "UNREGISTERED-IMPORTED")).toBeVisible();
  await expect
    .poll(() => fixture.requests.at(-1).args.p_search_skus)
    .toEqual(["UNREGISTERED-IMPORTED"]);
  expect(fixture.optionRequests).toHaveLength(before);
});

for (const [role, revision] of [
  ["operator", "settlement"],
  ["operator", "data_kiosk"],
  ["operator", "fees"],
  ["company_member", "fees"],
]) {
  test(`${role} refreshes SKU search matches before dependent reads after ${revision} changes`, async ({
    page,
  }) => {
    await page.clock.install();
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    fixture.skuOptions = ["OLD-SKU"];
    fixture.assignments = skuAssignments(["OLD-SKU"]);
    fixture.liveRows = [{ ...liveRow("OLD", 1), sku: "OLD-SKU" }];
    await signIn(page);
    await page.getByLabel("Search", { exact: true }).fill("new");
    await expect.poll(() => fixture.countRequests.at(-1).args.p_search_skus).toEqual([]);
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
    const before = fixture.requests.length;
    const started = deferred();
    const release = deferred();
    const wait = async () => {
      started.resolve();
      await release.promise;
    };
    if (role === "operator") fixture.beforeOptions = wait;
    else fixture.beforeAssignments = wait;
    fixture.skuOptions = ["OLD-SKU", "NEW-SKU"];
    fixture.assignments = skuAssignments(["OLD-SKU", "NEW-SKU"]);
    fixture.liveRows.push({ ...liveRow("NEW", 1), sku: "NEW-SKU" });
    fixture.revisions[revision] = "1";
    try {
      await page.clock.fastForward(60_000);
      await started.promise;
      expect(fixture.requests).toHaveLength(before);
    } finally {
      release.resolve();
    }
    await expect(rowWithSku(page, "NEW-SKU")).toBeVisible();
    await expect.poll(() => fixture.countRequests.at(-1).args.p_search_skus).toEqual(["NEW-SKU"]);
    expect(
      fixture.requests.slice(before).every(({ args }) => args.p_search_skus?.includes("NEW-SKU")),
    ).toBe(true);
    if (role === "operator")
      expect(fixture.revisionRequests.at(-1).sources.sort()).toEqual([
        "data_kiosk",
        "fees",
        "inventory",
        "payouts",
        "settlement",
      ]);
    else expect(fixture.optionRequests).toHaveLength(0);
  });
}
