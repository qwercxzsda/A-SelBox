import { sortBy } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

test("Transactions use page-first REST reads and reuse counts while both date and reported amount sorting share the RPC", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  expect(fixture.requests.at(-1).transport).toBe("rpc");
  expect(fixture.requests.at(-1).args.p_include_count).toBe(false);
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  expect(fixture.countRequests).toHaveLength(1);

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  expect(fixture.requests.at(-1).args).toMatchObject({ p_offset: 25, p_include_count: false });

  await sortBy(page, "Date", "Oldest first");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  expect(fixture.requests.at(-1).args).toMatchObject({
    p_direction: "asc",
    p_fee_applicable: null,
    p_offset: 0,
    p_include_count: false,
  });

  await sortBy(page, "Reported amount", "Highest first");
  await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("amount");
  expect(fixture.requests.at(-1).params.get("order")).toBe(
    "source_amount.desc.nullslast,source.asc,source_row_id.asc",
  );
  expect(fixture.countRequests).toHaveLength(1);

  await sortBy(page, "Date", "Newest first");
  await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("SKU_100%");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("SKU_100%");
  expect(fixture.requests.at(-1).transport).toBe("rpc");
});

test("an uncounted empty RPC page refreshes its separate count and clamps navigation", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  const before = fixture.requests.length;
  const countsBefore = fixture.countRequests.length;
  fixture.totalCount = 5;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 1 of 1", exact: true })).toBeVisible();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(6);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const recovery = fixture.requests.slice(before).filter(({ args }) => args?.p_offset === 25);
  expect(recovery.map(({ args }) => args.p_include_count)).toEqual([false]);
  expect(fixture.countRequests).toHaveLength(countsBefore + 1);
});
