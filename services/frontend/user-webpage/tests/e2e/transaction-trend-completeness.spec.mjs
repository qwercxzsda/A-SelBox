import { expect, test } from "@playwright/test";
import transactionTypes from "../../src/generated/transaction-types.json" with { type: "json" };
import { applyDates, selectColumnOptions } from "./table-actions.mjs";
import {
  chartPeriodSelect,
  selectedTrendAmount,
  setupTrendPage,
  trendBucket,
  trendChart,
  trendRegion,
} from "./transaction-trend-fixtures.mjs";

test("daily and weekly trends load more than 1000 filtered groups in one complete response", async ({
  page,
}) => {
  const types = transactionTypes
    .filter(({ route }) => route === "SKU")
    .slice(0, 12)
    .map(({ type }) => type);
  expect(types).toHaveLength(12);
  const rows = [];
  for (let week = 0; week < 52; week++) {
    const date = new Date("2025-11-03T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + week * 7);
    for (const [marketplace, currency, multiplier] of [
      ["Amazon.com", "USD", 1],
      ["Amazon.ca", "CAD", 10],
    ]) {
      for (const [index, type] of types.entries()) {
        rows.push(
          trendBucket(date.toISOString().slice(0, 10), String((index + 1) * multiplier), {
            type,
            sku: "BETA",
            marketplace,
            currency,
          }),
        );
      }
    }
  }
  rows.push(
    trendBucket("2026-10-26", "900000", { type: types[0], sku: "ALPHA" }),
    trendBucket("2026-10-26", "800000", { type: "STORAGE_FEES", sku: "BETA" }),
  );
  const fixture = await setupTrendPage(page, "member", rows);
  await selectColumnOptions(page, "SKU", ["BETA"]);
  await selectColumnOptions(page, "Source", ["Finances"]);
  await applyDates(page, "2025-11-01", "2026-10-31");

  for (const [mode, granularity] of [
    ["Daily", "day"],
    ["Weekly", "week"],
  ]) {
    const response = page.waitForResponse(
      (entry) =>
        new URL(entry.url()).pathname === "/rest/v1/rpc/transaction_totals" &&
        entry.request().method() === "POST" &&
        entry.request().postDataJSON().p_granularity === granularity,
    );
    await page.getByRole("button", { name: `${mode} trends`, exact: true }).click();
    const payload = await (await response).json();
    expect(Object.keys(payload).sort()).toEqual(["group_count", "rows"]);
    expect(payload.group_count).toBe("1248");
    expect(payload.rows).toHaveLength(1248);
    expect(new Set(payload.rows.map((row) => row.component_type))).toEqual(new Set(types));
    expect(new Set(payload.rows.map((row) => row.marketplace_name))).toEqual(
      new Set(["Amazon.com", "Amazon.ca"]),
    );
    await expect(trendRegion(page, mode).getByRole("figure")).toHaveCount(2);
    for (const [currency, amount] of [
      ["USD", "78.00"],
      ["CAD", "780.00"],
    ]) {
      const chart = trendChart(page, currency, mode);
      for (const period of ["2025-11-03", "2026-10-26"]) {
        await chartPeriodSelect(chart, granularity).selectOption(period);
        await expect(selectedTrendAmount(chart)).toHaveText(amount);
      }
    }
    const calls = fixture.trendRequests.filter(({ args }) => args.p_granularity === granularity);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      p_skus: ["BETA"],
      p_sources: ["FINANCES"],
      p_date_from: "2025-11-01",
      p_date_to: "2026-10-31",
    });
    expect(calls[0].args).not.toHaveProperty("p_limit");
    expect(calls[0].args).not.toHaveProperty("p_offset");
  }
});
