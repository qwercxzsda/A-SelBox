import { applyDates } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn, waitForRequestSettled } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCards as cards,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

function seedPeriods(fixture) {
  fixture.aggregateRows = [
    summaryBucket("2026-01-10", "5"),
    summaryBucket("2026-02-05", "10"),
    summaryBucket("2026-03-15", "50"),
  ];
}

const hasDate = (params, bound) => params.getAll("activity_date").includes(bound);

test("date discovery gates automatic totals while an explicit selected range loads independently", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  seedPeriods(fixture);
  const started = deferred();
  const release = deferred();
  fixture.beforeLatest = async () => {
    started.resolve();
    await release.promise;
  };
  await signIn(page);
  await started.promise;
  const { day, month, selected } = cards(page);
  await expect(
    day.getByRole("status", { name: "Loading latest day totals", exact: true }),
  ).toBeVisible();
  await expect(
    month.getByRole("status", { name: "Loading latest month totals", exact: true }),
  ).toBeVisible();
  expect(fixture.aggregateRequests).toHaveLength(0);
  await expect(selected).toContainText("Select a date range to see totals.");

  await applyDates(page, "2026-01-10", "2026-01-10");
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
  expect(fixture.aggregateRequests).toHaveLength(1);
  expect(fixture.aggregateRequests[0].params.getAll("activity_date")).toEqual([
    "gte.2026-01-10",
    "lte.2026-01-10",
  ]);
  release.resolve();
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await expect(amount(month, "Reported amount")).toHaveText("10 USD");
  const bounds = fixture.aggregateRequests.map(({ params }) =>
    params.getAll("activity_date").join(),
  );
  expect(new Set(bounds)).toEqual(
    new Set([
      "gte.2026-01-10,lte.2026-01-10",
      "gte.2026-03-15,lte.2026-03-15",
      "gte.2026-02-01,lte.2026-02-28",
    ]),
  );
});

test("a failed month keeps day and selected totals usable and retry recovers that period", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  seedPeriods(fixture);
  fixture.aggregateStatusForRequest = ({ params }) =>
    hasDate(params, "gte.2026-02-01") ? 403 : 200;
  await signIn(page);
  const { summaries, day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await expect(month).toContainText("Summary unavailable.");
  await expect(summaries.getByRole("alert")).toContainText("Latest month:");
  await applyDates(page, "2026-01-10", "2026-01-10");
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  fixture.aggregateStatusForRequest = null;
  await summaries.getByRole("button", { name: "Retry summaries", exact: true }).click();
  await expect(amount(month, "Reported amount")).toHaveText("10 USD");
  await expect(summaries.getByRole("alert")).toHaveCount(0);
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
});

test("an uncached selected range hides old totals and a late response cannot replace its successor", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  seedPeriods(fixture);
  fixture.aggregateRows.push(summaryBucket("2026-01-11", "22"), summaryBucket("2026-01-12", "33"));
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await expect(amount(month, "Reported amount")).toHaveText("10 USD");
  await applyDates(page, "2026-01-10", "2026-01-10");
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
  const started = deferred();
  const release = deferred();
  fixture.beforeAggregates = async ({ params }) => {
    if (hasDate(params, "gte.2026-01-11")) {
      started.resolve();
      await release.promise;
    }
  };
  const olderSettled = waitForRequestSettled(page, (request) => {
    if (new URL(request.url()).pathname !== "/rest/v1/rpc/transaction_totals") return false;
    const args = request.postDataJSON();
    return args.p_group_by_type === false && args.p_date_from === "2026-01-11";
  });
  await applyDates(page, "2026-01-11", "2026-01-11");
  await started.promise;
  await expect(
    selected.getByRole("status", { name: "Loading selected dates totals", exact: true }),
  ).toBeVisible();
  await expect(selected).not.toContainText("5 USD");
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await applyDates(page, "2026-01-12", "2026-01-12");
  await expect(amount(selected, "Reported amount")).toHaveText("33 USD");
  release.resolve();
  await olderSettled;
  await selected.evaluate(
    (element) =>
      new Promise((resolve) =>
        element.ownerDocument.defaultView.requestAnimationFrame(() => resolve()),
      ),
  );
  await expect(amount(selected, "Reported amount")).toHaveText("33 USD");
  await expect(selected).not.toContainText("22 USD");
});

test("an empty transaction dataset discovers no date and sends no automatic aggregate requests", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = [];
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(day).toContainText("No transactions yet.");
  await expect(month).toContainText("No full month available.");
  await expect(selected).toContainText("Select a date range to see totals.");
  expect(fixture.latestRequests.length).toBeGreaterThan(0);
  expect(fixture.aggregateRequests).toHaveLength(0);
  expect(fixture.breakdownRequests).toHaveLength(0);
});

test("refreshing the latest date to month end updates both bounded periods", async ({ page }) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  seedPeriods(fixture);
  await signIn(page);
  const { day, month } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await expect(amount(month, "Reported amount")).toHaveText("10 USD");
  const discoveries = fixture.latestRequests.length;
  fixture.aggregateRows.push(summaryBucket("2026-03-31", "7"));
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(60_000);
  await expect(amount(day, "Reported amount")).toHaveText("7 USD");
  await expect(amount(month, "Reported amount")).toHaveText("57 USD");
  expect(fixture.latestRequests.length).toBeGreaterThan(discoveries);
  const requests = fixture.aggregateRequests.map(({ params }) => params.getAll("activity_date"));
  expect(requests).toContainEqual(["gte.2026-03-31", "lte.2026-03-31"]);
  expect(requests).toContainEqual(["gte.2026-03-01", "lte.2026-03-31"]);
});

test("an offline uncached selected range stays pending until reconnect instead of claiming no transactions", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  seedPeriods(fixture);
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("50 USD");
  await expect(amount(month, "Reported amount")).toHaveText("10 USD");
  const requests = fixture.aggregateRequests.length;
  await page.context().setOffline(true);
  await applyDates(page, "2026-01-10", "2026-01-10");
  await expect(
    selected.getByRole("status", { name: "Loading selected dates totals", exact: true }),
  ).toBeVisible();
  await expect(selected).not.toContainText("No transactions");
  expect(fixture.aggregateRequests).toHaveLength(requests);
  await page.context().setOffline(false);
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
});
