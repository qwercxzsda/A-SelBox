import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { financesRow, kioskRow } from "./api-fixtures.mjs";

const CASES = [
  { tab: "Transactions", dataset: "live", revision: "finances" },
  { tab: "Finances", dataset: "finances", revision: "finances" },
  { tab: "Data Kiosk", dataset: "data_kiosk", revision: "data_kiosk" },
  { tab: "Payout reports", dataset: "payouts", revision: "payouts" },
  { tab: "User access", dataset: "accounts", revision: null },
];

const heading = (page) => page.locator(".workspace-header");
const status = (page) => heading(page).getByRole("status");
const toolbar = (page) => page.locator(".table-toolbar");
const rows = (page, dataset) =>
  page
    .getByRole("table", {
      name: dataset === "accounts" ? "User accounts" : "Financial records",
      exact: true,
    })
    .locator("tbody tr");

function matchesRows(request, dataset) {
  if (["OPTIONS", "HEAD"].includes(request.method())) return false;
  const path = new URL(request.url()).pathname;
  if (dataset === "live")
    return path === "/rest/v1/rpc/transaction_page" && request.postDataJSON().p_limit !== 1;
  if (dataset === "finances" || dataset === "data_kiosk")
    return (
      path === "/rest/v1/rpc/source_transaction_page" &&
      request.postDataJSON().p_dataset === dataset
    );
  return (
    path ===
    (dataset === "payouts"
      ? "/rest/v1/latest_company_payout_reports"
      : "/rest/v1/rpc/account_directory")
  );
}

async function setup(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.financesRows = [financesRow(1)];
  fixture.kioskRows = [kioskRow(1, "10")];
  fixture.payoutRows = [
    {
      id: "0198b50b-701a-7000-8000-000000000002",
      company_id: "company-member-a",
      marketplace_name: "Amazon.com",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      created_at: "2026-09-27T00:00:00Z",
      currency: "USD",
    },
  ];
  return fixture;
}

async function expectSameHeading(page, previous) {
  const current = await heading(page).boundingBox();
  expect(current.y).toBeCloseTo(previous.y, 0);
  expect(current.height).toBeCloseTo(previous.height, 0);
}

for (const { tab, dataset, revision, width } of CASES.flatMap((entry) =>
  (entry.dataset === "accounts" ? [1440, 360] : [1440]).map((width) => ({ ...entry, width })),
)) {
  test(`${tab} keeps initial loading and background updating beside its title at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.install();
    const fixture = await setup(page);
    let gate = { started: deferred(), release: deferred() };
    await page.route("https://example.invalid/rest/v1/**", async (route) => {
      const current = gate;
      if (current && matchesRows(route.request(), dataset)) {
        current.started.resolve();
        await current.release.promise;
      }
      await route.fallback();
    });
    try {
      await signIn(page);
      const tabs = page.getByRole("tablist", { name: "Workspace data", exact: true });
      await expect(tabs).toBeVisible({ timeout: 30_000 });
      if (tab !== "Transactions") await tabs.getByRole("tab", { name: tab, exact: true }).click();
      await gate.started.promise;
      await expect(heading(page).getByRole("heading", { name: tab, exact: true })).toBeVisible();
      await expect(status(page)).toHaveText("Loading…");
      await expect(toolbar(page).getByText(/Loading|Updating/)).toHaveCount(0);
      await expect(page.getByText("Loading rows…", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Loading reports…", { exact: true })).toHaveCount(0);
      const initialHeading = await heading(page).boundingBox();
      const initialSearchWidth = (
        await toolbar(page).getByLabel("Search", { exact: true }).boundingBox()
      ).width;
      gate.release.resolve();
      gate = null;
      await expect(rows(page, dataset).first()).toBeVisible();
      await expect(status(page)).toHaveText("");
      await expectSameHeading(page, initialHeading);
      expect(
        (await toolbar(page).getByLabel("Search", { exact: true }).boundingBox()).width,
      ).toBeCloseTo(initialSearchWidth, 0);

      gate = { started: deferred(), release: deferred() };
      if (revision) fixture.revisions[revision] = "changed";
      await page.clock.fastForward(60_000);
      await gate.started.promise;
      await expect(status(page)).toHaveText("Updating…");
      await expect(rows(page, dataset).first()).toBeVisible();
      await expectSameHeading(page, initialHeading);
      gate.release.resolve();
      gate = null;
      await expect(status(page)).toHaveText("");
      await expectSameHeading(page, initialHeading);
    } finally {
      gate?.release.resolve();
    }
  });
}

test("a pending count and its failed retry use the title without hiding usable transaction rows", async ({
  page,
}) => {
  const fixture = await setup(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async () => {
    started.resolve();
    await release.promise;
  };
  fixture.countStatusForRequest = () => 403;
  try {
    await signIn(page);
    await started.promise;
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expect(status(page)).toHaveText("Updating…");
    await expect(page.getByText("Counting rows…", { exact: true })).toHaveCount(0);
    release.resolve();
    const retry = page.getByRole("button", { name: "Retry count", exact: true });
    await expect(retry).toBeVisible();
    await expect(status(page)).toHaveText("");
    const rowReads = fixture.requests.length;
    const retryStarted = deferred();
    const retryRelease = deferred();
    fixture.countStatusForRequest = () => 200;
    fixture.beforeCount = async () => {
      retryStarted.resolve();
      await retryRelease.promise;
    };
    try {
      await retry.focus();
      await page.keyboard.press("Enter");
      await retryStarted.promise;
      await expect(status(page)).toHaveText("Updating…");
      await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
      retryRelease.resolve();
      await expect(status(page)).toHaveText("");
      await expect(retry).toHaveCount(0);
      await expect(toolbar(page)).toBeFocused();
      expect(fixture.requests).toHaveLength(rowReads);
    } finally {
      retryRelease.resolve();
    }
  } finally {
    release.resolve();
  }
});

test("a paused source page keeps its offline explanation and resumes with title progress", async ({
  page,
  context,
}) => {
  await setup(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await context.setOffline(true);
  try {
    await page.getByRole("tab", { name: "Finances", exact: true }).click();
    const waiting = page.getByText("Waiting for a connection to load rows…", { exact: true });
    await expect(waiting).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
    await context.setOffline(false);
    await expect(waiting).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "FINANCES-1", exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");
  } finally {
    await context.setOffline(false);
  }
});

for (const width of [1440, 360]) {
  test(`Companies retains its directory and heading geometry during catalog refresh at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.install();
    const fixture = await setup(page);
    await signIn(page);
    await page.getByRole("tab", { name: "Companies", exact: true }).click();
    const table = page.getByRole("table", { name: "Companies", exact: true });
    await expect(table.getByText("Company A", { exact: true })).toBeVisible();
    const before = await heading(page).boundingBox();
    const started = deferred();
    const release = deferred();
    fixture.beforeCompanies = async () => {
      started.resolve();
      await release.promise;
    };
    fixture.revisions.fees = "new-directory";
    try {
      await page.clock.fastForward(60_000);
      await started.promise;
      await expect(status(page)).toHaveText("Updating…");
      await expect(table.getByText("Company A", { exact: true })).toBeVisible();
      await expectSameHeading(page, before);
      release.resolve();
      await expect(status(page)).toHaveText("");
      await expectSameHeading(page, before);
    } finally {
      release.resolve();
    }
  });
}
