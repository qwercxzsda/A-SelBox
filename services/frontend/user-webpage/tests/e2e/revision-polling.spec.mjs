import { expect, test } from "@playwright/test";
import { feeRow, kioskRow, settlementRow, skuAssignment } from "./api-fixtures.mjs";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { summaryAmount, summaryBucket, summaryCards, typeBucket } from "./summary-fixtures.mjs";

const completedPolls = (fixture) => fixture.revisionRequests.filter(({ completed }) => completed);
const financialRequests = (fixture) => ({
  rows: fixture.requests.length,
  counts: fixture.countRequests.length,
  options: fixture.optionRequests.length,
  latest: fixture.latestRequests.length,
  totals: fixture.aggregateRequests.length,
  details: fixture.breakdownRequests.length,
  fees: fixture.configurationRequests.length,
});

async function setup(page, role = "company_member") {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.aggregateRows = [summaryBucket("2026-08-31", "20"), summaryBucket("2026-09-01", "10")];
  fixture.breakdownRows = [typeBucket("PRINCIPAL", "10")];
  fixture.assignments = [skuAssignment(1)];
  fixture.feeRows = [feeRow(0)];
  fixture.settlementRows = [settlementRow(1)];
  fixture.kioskRows = [kioskRow(1, "10")];
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await expect(summaryAmount(summaryCards(page).day, "Reported amount")).toHaveText("10 USD");
  await expect(summaryAmount(summaryCards(page).month, "Reported amount")).toHaveText("20 USD");
  await expect.poll(() => completedPolls(fixture).length).toBe(1);
  return fixture;
}

async function finishPoll(page, fixture, count) {
  await expect.poll(() => completedPolls(fixture).length).toBeGreaterThan(count);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}

test("initial sign-in captures revisions before loading dependent lookups and financial data", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeRevisions = async () => {
    started.resolve();
    await release.promise;
  };
  try {
    await page.getByLabel(/^Email/).fill("member-a@example.test");
    await page.getByLabel(/^Password/).fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await started.promise;
    expect(fixture.identityRequests).toHaveLength(0);
    expect(financialRequests(fixture)).toEqual({
      rows: 0,
      counts: 0,
      options: 0,
      latest: 0,
      totals: 0,
      details: 0,
      fees: 0,
    });
    release.resolve();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    expect(fixture.revisionRequests).toHaveLength(1);
    expect(fixture.identityRequests).toHaveLength(2);
  } finally {
    release.resolve();
  }
});

test("unchanged periodic revisions perform one small request and retain every financial cache and identity lookup", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
  await expect(page.getByRole("region", { name: "Breakdown total", exact: true })).toBeVisible();
  const financial = financialRequests(fixture);
  const identity = fixture.identityRequests.length;
  const initial = completedPolls(fixture).length;

  await page.clock.fastForward(60_000);
  await finishPoll(page, fixture, initial);
  expect(completedPolls(fixture)).toHaveLength(initial + 1);
  expect(fixture.revisionRequests.at(-1).sources.sort()).toEqual([
    "data_kiosk",
    "fees",
    "settlement",
  ]);
  expect(financialRequests(fixture)).toEqual(financial);
  expect(fixture.identityRequests).toHaveLength(identity);
  expect(fixture.authRequests).toBe(1);
  await expect(page.getByRole("dialog", { name: "Amounts by type", exact: true })).toBeVisible();
});

for (const source of ["settlement", "data_kiosk"]) {
  test(`${source} changes reload the live table, summaries, open details and administrator SKU options after refreshing identity catalogs`, async ({
    page,
  }) => {
    const fixture = await setup(page, "operator");
    await page.getByRole("button", { name: "SKU", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "SKU options", exact: true }).getByRole("checkbox").first(),
    ).toBeVisible();
    const options = fixture.optionRequests.length;
    const identity = fixture.identityRequests.length;
    const initial = completedPolls(fixture).length;
    fixture.revisions[source] = "1";
    fixture.prefixes["member-a"] = "UPDATED";
    fixture.aggregateRows[1] = summaryBucket("2026-09-01", "30");
    await page.clock.fastForward(60_000);
    await finishPoll(page, fixture, initial);
    await expect(rowWithSku(page, "UPDATED-001")).toBeVisible();
    await expect(summaryAmount(summaryCards(page).day, "Reported amount")).toHaveText("30 USD");
    await expect.poll(() => fixture.optionRequests.length).toBeGreaterThan(options);
    expect(fixture.identityRequests.length).toBeGreaterThan(identity);

    await page
      .getByRole("dialog", { name: "SKU options", exact: true })
      .getByRole("button", { name: "Close options", exact: true })
      .click();
    await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
    const total = page.getByRole("region", { name: "Breakdown total", exact: true });
    await expect(summaryAmount(total, "Reported amount")).toHaveText("10 USD");
    const details = fixture.breakdownRequests.length;
    const next = completedPolls(fixture).length;
    fixture.revisions[source] = "2";
    fixture.breakdownRows = [typeBucket("PRINCIPAL", "30")];
    await page.clock.fastForward(60_000);
    await finishPoll(page, fixture, next);
    await expect(summaryAmount(total, "Reported amount")).toHaveText("30 USD");
    expect(fixture.breakdownRequests.length).toBeGreaterThan(details);
    expect(fixture.identityRequests.length).toBeGreaterThan(identity);
  });
}

for (const [source, tab, other] of [
  ["settlement", "Settlements", "data_kiosk"],
  ["data_kiosk", "Data Kiosk", "settlement"],
]) {
  test(`an administrator's ${tab} table reloads only for its own source, while inactive totals catch up on return`, async ({
    page,
  }) => {
    const fixture = await setup(page, "operator");
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const sku = source === "settlement" ? "SETTLEMENT-1" : "KIOSK-1";
    await expect(rowWithSku(page, sku)).toBeVisible();
    const rows = () => fixture.requests.filter(({ dataset }) => dataset === source).length;
    const initialRows = rows();
    const summaryRequests = fixture.aggregateRequests.length;
    const identity = fixture.identityRequests.length;
    let pollCount = completedPolls(fixture).length;

    fixture.revisions[other] = "1";
    fixture.aggregateRows[1] = summaryBucket("2026-09-01", "30");
    await page.clock.fastForward(60_000);
    await finishPoll(page, fixture, pollCount);
    await expect(summaryCards(page).summaries).toHaveCount(0);
    expect(fixture.aggregateRequests).toHaveLength(summaryRequests);
    expect(rows()).toBe(initialRows);
    expect(fixture.identityRequests.length).toBeGreaterThan(identity);

    pollCount = completedPolls(fixture).length;
    fixture.revisions.fees = "1";
    fixture.aggregateRows[1] = summaryBucket("2026-09-01", "30", {
      serviceFee: "3",
      companyAmount: "27",
    });
    await page.clock.fastForward(60_000);
    await finishPoll(page, fixture, pollCount);
    await expect(summaryCards(page).summaries).toHaveCount(0);
    expect(fixture.aggregateRequests).toHaveLength(summaryRequests);
    expect(rows()).toBe(initialRows);
    expect(fixture.identityRequests.length).toBeGreaterThan(identity);

    pollCount = completedPolls(fixture).length;
    fixture.revisions[source] = "1";
    if (source === "settlement") fixture.settlementRows = [settlementRow("UPDATED", "40")];
    else fixture.kioskRows = [kioskRow("UPDATED", "40")];
    await page.clock.fastForward(60_000);
    await finishPoll(page, fixture, pollCount);
    await expect(
      rowWithSku(page, source === "settlement" ? "SETTLEMENT-UPDATED" : "KIOSK-UPDATED"),
    ).toBeVisible();
    expect(rows()).toBeGreaterThan(initialRows);
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await expect(summaryAmount(summaryCards(page).day, "Reported amount")).toHaveText("30 USD");
    await expect(summaryAmount(summaryCards(page).day, "Service fee")).toHaveText("3 USD");
  });
}

test("source and fee revisions refresh current configuration and its coverage requirements", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await page
    .getByRole("button", { name: "Show marketplace fees for GROUP-001", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: "4.8%", exact: true })).toBeVisible();
  const fees = fixture.configurationRequests.length;
  const identity = fixture.identityRequests.length;
  let initial = completedPolls(fixture).length;
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(60_000);
  await finishPoll(page, fixture, initial);
  expect(fixture.configurationRequests.length).toBeGreaterThan(fees);
  expect(fixture.identityRequests).toHaveLength(identity);

  initial = completedPolls(fixture).length;
  fixture.revisions.fees = "1";
  fixture.feeRows[0] = { ...feeRow(0), fee_rate_percent: "7.5" };
  fixture.assignments.push(skuAssignment(2));
  await page.clock.fastForward(60_000);
  await finishPoll(page, fixture, initial);
  await expect(page.getByRole("cell", { name: "7.5%", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show marketplace fees for GROUP-002", exact: true }),
  ).toBeVisible();
  expect(fixture.configurationRequests.length).toBeGreaterThan(fees);
  expect(fixture.identityRequests.length).toBeGreaterThan(identity);
});

test("offline tabs do not poll and reconnect checks revisions without reloading unchanged data", async ({
  page,
}) => {
  const fixture = await setup(page);
  const requests = fixture.revisionRequests.length;
  const financial = financialRequests(fixture);
  const identity = fixture.identityRequests.length;
  await page.context().setOffline(true);
  await page.clock.fastForward(120_000);
  expect(fixture.revisionRequests).toHaveLength(requests);
  await page.context().setOffline(false);
  await finishPoll(page, fixture, requests);
  expect(financialRequests(fixture)).toEqual(financial);
  expect(fixture.identityRequests).toHaveLength(identity);
});

test("simultaneous timer, focus, and reconnect events share one pending revision check", async ({
  page,
}) => {
  const fixture = await setup(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeRevisions = async () => {
    started.resolve();
    await release.promise;
  };
  const initial = fixture.revisionRequests.length;
  const financial = financialRequests(fixture);
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    await page.evaluate(() => {
      globalThis.dispatchEvent(new globalThis.Event("focus"));
      globalThis.dispatchEvent(new globalThis.Event("online"));
    });
    await page.clock.fastForward(60_000);
    expect(fixture.revisionRequests).toHaveLength(initial + 1);
    release.resolve();
    await finishPoll(page, fixture, initial);
    expect(financialRequests(fixture)).toEqual(financial);
  } finally {
    release.resolve();
  }
});

test("a failed revision check keeps displayed data and the next successful check still detects the change", async ({
  page,
}) => {
  const fixture = await setup(page);
  const financial = financialRequests(fixture);
  fixture.revisions.settlement = "1";
  fixture.prefixes["member-a"] = "RECOVERED";
  fixture.revisionStatus = 503;
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  expect(financialRequests(fixture)).toEqual(financial);
  fixture.revisionStatus = 200;
  const initial = completedPolls(fixture).length;
  await page.clock.fastForward(60_000);
  await finishPoll(page, fixture, initial);
  await expect(rowWithSku(page, "RECOVERED-001")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a removed account loses its cached financial workspace on the next revision check", async ({
  page,
}) => {
  const fixture = await setup(page);
  delete fixture.roles["member-a"];
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Financial records", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Estimated totals", exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.sessionStorage.getItem("aselbox.auth.session.v1:https://example.invalid"),
      ),
    )
    .toBeNull();
});

test("a failed changed-data refresh is retried by the next poll even when the revision has not changed again", async ({
  page,
}) => {
  const fixture = await setup(page);
  const rows = fixture.requests.length;
  fixture.revisions.settlement = "1";
  fixture.prefixes["member-a"] = "RECOVERED";
  fixture.status = 503;
  await page.clock.fastForward(60_000);
  await expect.poll(() => fixture.requests.length).toBeGreaterThan(rows);
  await page.clock.runFor(1_500);
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not check for updates" }),
  ).toContainText("HTTP 503");
  expect(fixture.requests.length).toBe(rows + 2);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  fixture.status = 200;
  const polls = completedPolls(fixture).length;
  await page.clock.fastForward(60_000);
  await finishPoll(page, fixture, polls);
  await expect(rowWithSku(page, "RECOVERED-001")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fixture.revisions.settlement).toBe("1");
});

test("an account role change rebuilds the workspace with the current permissions", async ({
  page,
}) => {
  const fixture = await setup(page, "operator");
  await page.getByRole("tab", { name: "Settlements", exact: true }).click();
  await expect(rowWithSku(page, "SETTLEMENT-1")).toBeVisible();
  fixture.roles["member-a"] = "company_member";
  fixture.prefixes["member-a"] = "MEMBER";
  await page.clock.fastForward(60_000);
  await expect(rowWithSku(page, "MEMBER-001")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Settlements", exact: true })).toHaveCount(0);
  await expect(page.getByText("Administrator", { exact: true })).toHaveCount(0);
  expect(fixture.authRequests).toBe(1);
});

test("a late revision response from a signed-out account cannot refresh another account", async ({
  page,
}) => {
  const fixture = await setup(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeRevisions = async ({ user }) => {
    if (user === "member-a") {
      started.resolve();
      await release.promise;
    }
  };
  fixture.revisionsByUser["member-a"] = { settlement: "1", data_kiosk: "0", fees: "1" };
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, "member-b");
    await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
    const financial = financialRequests(fixture);
    const identity = fixture.identityRequests.length;
    release.resolve();
    await expect
      .poll(
        () =>
          fixture.revisionRequests.filter(
            ({ user, completed, failure }) => user === "member-a" && (completed || failure),
          ).length,
      )
      .toBe(2);
    await page.clock.runFor(100);
    await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
    await expect(rowWithSku(page, "ALPHA-001")).toHaveCount(0);
    expect(financialRequests(fixture)).toEqual(financial);
    expect(fixture.identityRequests).toHaveLength(identity);
  } finally {
    release.resolve();
  }
});

test("token rotation cancels an old-token revision check before its late rejection can reuse the refresh token", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const refreshCalls = () =>
    fixture.authCalls.filter(({ grantType }) => grantType === "refresh_token");
  fixture.authSessionForRequest = ({ grantType, user }) => ({
    access_token: grantType === "password" ? "initial-access" : "rotated-access",
    refresh_token: grantType === "password" ? "initial-refresh" : "rotated-refresh",
    token_type: "bearer",
    expires_in: grantType === "password" ? 180 : 3600,
    user: { id: user, email: `${user}@example.test` },
  });
  fixture.authStatusForRequest = ({ grantType, refreshToken }) =>
    grantType === "refresh_token" && refreshToken === "initial-refresh" && refreshCalls().length > 1
      ? 400
      : 200;
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const started = deferred();
  const release = deferred();
  let oldPoll;
  fixture.beforeRevisions = async (entry) => {
    if (entry.accessToken === "initial-access") {
      oldPoll = entry;
      started.resolve();
      await release.promise;
    }
  };
  fixture.revisionStatusForRequest = ({ accessToken }) =>
    accessToken === "initial-access" ? 401 : 200;
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    await page.clock.fastForward(60_000);
    await expect
      .poll(
        () =>
          fixture.identityRequests.filter(({ accessToken }) => accessToken === "rotated-access")
            .length,
      )
      .toBe(2);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              globalThis.sessionStorage.getItem("aselbox.auth.session.v1:https://example.invalid"),
            )?.access_token,
        ),
      )
      .toBe("rotated-access");
    release.resolve();
    await expect.poll(() => oldPoll.completed || oldPoll.failure).toBeTruthy();
    await page.clock.runFor(100);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(refreshCalls()).toHaveLength(1);
    expect(oldPoll.failure).toBe("net::ERR_ABORTED");
    const initialRequests = fixture.revisionRequests.filter(
      ({ accessToken }) => accessToken === "initial-access",
    );
    expect(initialRequests).toHaveLength(2);
  } finally {
    release.resolve();
  }
});

test("a manual retry requested during an unrelated selective refresh runs when that check finishes", async ({
  page,
}) => {
  const fixture = await setup(page, "operator");
  fixture.datasetStatusForRequest = ({ dataset }) => (dataset === "settlement" ? 403 : 200);
  await page.getByRole("tab", { name: "Settlements", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 403");
  fixture.revisionStatus = 503;
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("button", { name: "Retry update", exact: true })).toBeVisible();
  fixture.revisionStatus = 200;
  const started = deferred();
  const release = deferred();
  fixture.beforeRevisions = async () => {
    started.resolve();
    await release.promise;
  };
  fixture.revisions.data_kiosk = "1";
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    fixture.datasetStatusForRequest = null;
    await page.getByRole("button", { name: "Retry update", exact: true }).click();
    release.resolve();
    await expect(rowWithSku(page, "SETTLEMENT-1")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  } finally {
    release.resolve();
  }
});
