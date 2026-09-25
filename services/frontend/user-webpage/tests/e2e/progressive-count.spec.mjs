import { sortBy } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { kioskRow, liveRow } from "./api-fixtures.mjs";

const pagination = (page, number, total) =>
  page.getByRole("form", { name: `Page ${number} of ${total}`, exact: true });

test("rows load before their exact count and remain inspectable and navigable while it is pending", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 60;
  const rowsStarted = deferred();
  const rowsRelease = deferred();
  const countStarted = deferred();
  const countRelease = deferred();
  fixture.beforeDataset = async () => {
    rowsStarted.resolve();
    await rowsRelease.promise;
  };
  fixture.beforeCount = async () => {
    countStarted.resolve();
    await countRelease.promise;
  };
  try {
    await signIn(page);
    await rowsStarted.promise;
    expect(fixture.countRequests).toHaveLength(0);
    rowsRelease.resolve();
    await countStarted.promise;
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await expect(pagination(page, 1, "—")).toBeVisible();
    const pageNumber = page.getByLabel("Page number", { exact: true });
    await expect(pageNumber).toHaveAttribute("readonly", "");
    await rowWithSku(page, "ALPHA-002").click();
    const details = page.getByRole("dialog", { name: "Selected row details", exact: true });
    await expect(details.getByRole("heading", { name: "ALPHA-002", exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Close row details", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
    await expect(pagination(page, 2, "—")).toBeVisible();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    countRelease.resolve();
    await expect(pagination(page, 1, 3)).toBeVisible();
    await expect(pageNumber).not.toHaveAttribute("readonly", "");
    await pageNumber.fill("3");
    await pageNumber.press("Enter");
    await expect(rowWithSku(page, "ALPHA-051")).toBeVisible();
    await expect(pagination(page, 3, 3)).toBeVisible();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    expect(fixture.countRequests).toHaveLength(1);
    expect(fixture.requests.every(({ args }) => args?.p_include_count === false)).toBe(true);
  } finally {
    rowsRelease.resolve();
    countRelease.resolve();
  }
});

test("a count failure preserves rows and the count-only retry does not fetch them again", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.countStatusForRequest = () => 403;
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry count", exact: true });
  await expect(retry).toBeVisible();
  await expect(pagination(page, 1, "—")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
  await expect
    .poll(() => fixture.countRequests.filter(({ completed }) => completed).length)
    .toBe(2);
  await expect(retry).toBeEnabled();
  const rows = fixture.requests.length;
  fixture.countStatusForRequest = () => 200;
  await retry.click();
  await expect(pagination(page, 2, 2)).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(fixture.requests).toHaveLength(rows);
  expect(fixture.countRequests).toHaveLength(3);
});

test("financial counts survive page and sort changes and unchanged revision polls", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(pagination(page, 1, 2)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pagination(page, 2, 2)).toBeVisible();
  await sortBy(page, "Date", "Oldest first");
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await sortBy(page, "Reported amount", "Highest first");
  await expect.poll(() => fixture.requests.at(-1).args?.p_order_by).toBe("amount");
  await expect(pagination(page, 1, 2)).toBeVisible();
  const polls = fixture.revisionRequests.length;
  await page.clock.fastForward(60_000);
  await expect.poll(() => fixture.revisionRequests.length).toBeGreaterThan(polls);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
  expect(fixture.countRequests).toHaveLength(1);
});

test("an older unfiltered count cannot replace the selected SKU count", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = Array.from({ length: 60 }, (_, index) => liveRow("ALPHA", index + 1));
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async ({ params }) => {
    if (!params.has("sku")) {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await signIn(page);
    await started.promise;
    await page.getByRole("button", { name: "SKU", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "SKU options", exact: true });
    await menu.getByRole("checkbox", { name: "ALPHA-001", exact: true }).check();
    await menu.getByRole("button", { name: "Close options", exact: true }).click();
    await expect(pagination(page, 1, 1)).toBeVisible();
    release.resolve();
    await expect
      .poll(() => fixture.countRequests[0].completed || fixture.countRequests[0].failure)
      .toBeTruthy();
    await expect(pagination(page, 1, 1)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);
    expect(fixture.countRequests.map(({ count }) => count)).toEqual([60, 1]);
  } finally {
    release.resolve();
  }
});

test("a count from the signed-out account cannot replace the next account's total", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 60;
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async ({ user }) => {
    if (user === "member-a") {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await signIn(page);
    await started.promise;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    fixture.totalCount = 5;
    await signIn(page, "member-b");
    await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
    await expect(pagination(page, 1, 1)).toBeVisible();
    release.resolve();
    await expect
      .poll(() => fixture.countRequests[0].completed || fixture.countRequests[0].failure)
      .toBeTruthy();
    await expect(pagination(page, 1, 1)).toBeVisible();
    await expect(rowWithSku(page, "ALPHA-001")).toHaveCount(0);
    expect(fixture.countRequests.map(({ user, count }) => [user, count])).toEqual([
      ["member-a", 60],
      ["member-b", 5],
    ]);
  } finally {
    release.resolve();
  }
});

test("a shrinking publication refreshes rows before its delayed count clamps and reloads the earlier page", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.totalCount = 60;
  await signIn(page);
  await expect(pagination(page, 1, 3)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async () => {
    started.resolve();
    await release.promise;
  };
  fixture.totalCount = 5;
  fixture.prefixes["member-a"] = "UPDATED";
  fixture.revisions.settlement = "1";
  try {
    await page.clock.fastForward(60_000);
    await started.promise;
    await expect(rowWithSku(page, "ALPHA-026")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
    release.resolve();
    await expect(pagination(page, 1, 1)).toBeVisible();
    await expect(rowWithSku(page, "UPDATED-001")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(6);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(fixture.countRequests).toHaveLength(2);
  } finally {
    release.resolve();
  }
});

test("a newer publication replaces a pending count instead of accepting its older snapshot", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  fixture.totalCount = 60;
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async ({ count }) => {
    if (count === 60) {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await signIn(page);
    await started.promise;
    fixture.totalCount = 5;
    fixture.prefixes["member-a"] = "UPDATED";
    fixture.revisions.settlement = "1";
    await page.clock.fastForward(60_000);
    await expect(rowWithSku(page, "UPDATED-001")).toBeVisible();
    await expect(pagination(page, 1, 1)).toBeVisible();
    release.resolve();
    await expect
      .poll(() => fixture.countRequests[0].completed || fixture.countRequests[0].failure)
      .toBeTruthy();
    await expect(pagination(page, 1, 1)).toBeVisible();
    expect(fixture.countRequests.map(({ count }) => count)).toEqual([60, 5]);
  } finally {
    release.resolve();
  }
});

test("Data Kiosk rows do not wait for their independent RPC count", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "operator";
  fixture.kioskRows = Array.from({ length: 25 }, (_, index) => kioskRow(index + 1, "10"));
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async ({ dataset }) => {
    if (dataset === "data_kiosk") {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await signIn(page);
    await page.getByRole("tab", { name: "Data Kiosk", exact: true }).click();
    await started.promise;
    await expect(rowWithSku(page, "KIOSK-1")).toBeVisible();
    await expect(pagination(page, 1, "—")).toBeVisible();
    expect(fixture.countRequests.at(-1).transport).toBe("rpc");
    expect(fixture.countRequests.at(-1).params.get("amount")).toBe("neq.0");
    release.resolve();
    await expect(pagination(page, 1, 1)).toBeVisible();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  } finally {
    release.resolve();
  }
});

for (const width of [320, 1280]) {
  test(`the pending count keeps the table and pagination stable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockSupabase(page);
    const started = deferred();
    const release = deferred();
    fixture.beforeCount = async () => {
      started.resolve();
      await release.promise;
    };
    try {
      await signIn(page);
      await started.promise;
      const table = page.getByRole("table", { name: "Financial records", exact: true });
      const nav = page.getByRole("navigation", { name: "Pagination", exact: true });
      await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
      const beforeTable = await table.boundingBox();
      const beforeNav = await nav.boundingBox();
      await page.screenshot({ path: testInfo.outputPath("count-pending.png"), fullPage: true });
      release.resolve();
      await expect(pagination(page, 1, 2)).toBeVisible();
      const afterTable = await table.boundingBox();
      const afterNav = await nav.boundingBox();
      expect(Math.abs(afterTable.y - beforeTable.y)).toBeLessThan(1);
      expect(Math.abs(afterNav.y - beforeNav.y)).toBeLessThan(1);
      expect(afterNav.height).toBe(beforeNav.height);
      expect(afterNav.x).toBeGreaterThanOrEqual(0);
      expect(afterNav.x + afterNav.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath("count-ready.png"), fullPage: true });
    } finally {
      release.resolve();
    }
  });
}

test("an empty next page cancels an older pending count before accepting the new bound", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 50;
  const started = deferred();
  const release = deferred();
  fixture.beforeCount = async ({ count }) => {
    if (count === 50) {
      started.resolve();
      await release.promise;
    }
  };
  try {
    await signIn(page);
    await started.promise;
    fixture.totalCount = 5;
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(pagination(page, 1, 1)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(6);
    release.resolve();
    await expect
      .poll(() => fixture.countRequests[0].completed || fixture.countRequests[0].failure)
      .toBeTruthy();
    await expect(pagination(page, 1, 1)).toBeVisible();
    expect(fixture.countRequests.map(({ count }) => count)).toEqual([50, 5]);
  } finally {
    release.resolve();
  }
});

test("a first count smaller than the displayed first page refreshes that page", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 30;
  fixture.countTotalForRequest = () => 5;
  fixture.beforeCount = async () => {
    fixture.totalCount = 5;
  };
  await signIn(page);
  await expect(pagination(page, 1, 1)).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(6);
  const pages = fixture.requests.filter(({ args }) => args?.p_offset === 0);
  await expect.poll(() => pages.filter(({ completed }) => completed).length).toBe(2);
  for (const request of pages.filter(({ completed }) => !completed)) {
    expect(request.failure).toBe("net::ERR_ABORTED");
  }
});

test("new rows that contradict a cached count trigger a fresh count without a revision signal", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 10;
  await signIn(page);
  await expect(pagination(page, 1, 1)).toBeVisible();
  fixture.totalCount = 30;
  await sortBy(page, "Date", "Oldest first");
  await expect(page.getByRole("row")).toHaveCount(26);
  await expect(pagination(page, 1, 2)).toBeVisible();
  expect(fixture.countRequests.map(({ count }) => count)).toEqual([10, 30]);
});

test("an immediate revision row response still refreshes the count once", async ({ page }) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(pagination(page, 1, 2)).toBeVisible();
  fixture.totalCount = 60;
  fixture.revisions.settlement = "1";
  await page.clock.fastForward(60_000);
  await expect(pagination(page, 1, 3)).toBeVisible();
  expect(fixture.countRequests.map(({ count }) => count)).toEqual([30, 60]);
});
