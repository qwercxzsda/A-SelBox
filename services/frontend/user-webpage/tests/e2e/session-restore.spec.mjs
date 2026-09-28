import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";

const SESSION_KEY = "aselbox.auth.session.v1:https://example.invalid";
const restoring = (page) => page.getByRole("status").filter({ hasText: "Restoring session…" });
const refreshCalls = (fixture) =>
  fixture.authCalls.filter(({ grantType }) => grantType === "refresh_token");

async function storedSession(page) {
  return page.evaluate((key) => {
    const value = sessionStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  }, SESSION_KEY);
}

async function seedExpiredSession(page) {
  await page.evaluate((key) => {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        access_token: "token-member-a",
        refresh_token: "refresh-member-a",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) - 60,
        user: { id: "member-a", email: "member-a@example.test" },
      }),
    );
  }, SESSION_KEY);
}

for (const originalRole of ["company_member", "operator"]) {
  test(`reloading ${originalRole} verifies the token user and waits for fresh account and lookup data`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = originalRole;
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    const before = fixture.requests.length;
    const nextRole = originalRole === "operator" ? "company_member" : "operator";
    fixture.roles["member-a"] = nextRole;
    // Cached display identity must never override the user returned for the bearer token.
    await page.evaluate((key) => {
      const session = JSON.parse(sessionStorage.getItem(key));
      session.user = { id: "member-b", email: "cached-wrong@example.test" };
      sessionStorage.setItem(key, JSON.stringify(session));
    }, SESSION_KEY);
    const gates = [deferred(), deferred()];
    const started = [deferred(), deferred()];
    ["beforeCompanies", "beforeAssignments"].forEach((hook, index) => {
      fixture[hook] = async () => {
        started[index].resolve();
        await gates[index].promise;
      };
    });
    try {
      await page.reload();
      await Promise.all(started.map(({ promise }) => promise));
      await expect(restoring(page)).toBeVisible();
      await expect(page.getByRole("tab")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
      expect(fixture.requests).toHaveLength(before);
      gates[0].resolve();
      await expect(restoring(page)).toBeVisible();
      gates[1].resolve();
      await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
      await expect(page.getByRole("tab")).toHaveCount(nextRole === "operator" ? 6 : 3);
      await expect(page.locator("header")).toContainText("member-a@example.test");
      await expect(page.locator("header")).not.toContainText("cached-wrong@example.test");
      expect(fixture.revisionRequests.at(-1).user).toBe("member-a");
      expect(fixture.events.some(({ endpoint }) => endpoint === "/rest/v1/app_accounts")).toBe(
        false,
      );
      expect(fixture.sessionUserRequests.at(-1).accessToken).toBe("token-member-a");
      expect(fixture.authRequests).toBe(1);
      expect(refreshCalls(fixture)).toHaveLength(0);
    } finally {
      gates.forEach(({ resolve }) => resolve());
    }
  });
}

test("relative token expiry becomes absolute and reload refreshes once, saving rotated tokens before identity completes", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  const beforeSignIn = await page.evaluate(() => Math.floor(Date.now() / 1000));
  await signIn(page);
  const saved = await storedSession(page);
  expect(saved.expires_at).toBeGreaterThanOrEqual(beforeSignIn + 3600);
  expect(saved.expires_at).toBeLessThanOrEqual(
    await page.evaluate(() => Math.floor(Date.now() / 1000) + 3600),
  );
  expect(Object.keys(saved).sort()).toEqual([
    "access_token",
    "expires_at",
    "expires_in",
    "refresh_token",
    "token_type",
    "user",
  ]);
  expect(JSON.stringify(saved)).not.toContain("synthetic-password");
  await seedExpiredSession(page);
  const refreshing = deferred();
  const releaseRefresh = deferred();
  const checking = deferred();
  const releaseIdentity = deferred();
  fixture.beforeAuth = async ({ grantType }) => {
    if (grantType === "refresh_token") {
      refreshing.resolve();
      await releaseRefresh.promise;
    }
  };
  fixture.authSessionForRequest = ({ user }) => ({
    access_token: "rotated-access-token",
    refresh_token: "rotated-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: user, email: `${user}@example.test` },
  });
  fixture.beforeRevisions = async ({ accessToken }) => {
    if (accessToken === "rotated-access-token") {
      checking.resolve();
      await releaseIdentity.promise;
    }
  };
  try {
    await page.reload();
    await refreshing.promise;
    await expect(restoring(page)).toBeVisible();
    expect(refreshCalls(fixture)).toHaveLength(1);
    releaseRefresh.resolve();
    await checking.promise;
    const rotated = await storedSession(page);
    expect(rotated.access_token).toBe("rotated-access-token");
    expect(rotated.refresh_token).toBe("rotated-refresh-token");
    expect(rotated.expires_at).toBeGreaterThan(beforeSignIn);
    await expect(page.getByRole("tab")).toHaveCount(0);
    releaseIdentity.resolve();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    expect(refreshCalls(fixture)).toHaveLength(1);
    expect(fixture.sessionUserRequests).toHaveLength(0);
    expect(fixture.authRequests).toBe(2);
  } finally {
    releaseRefresh.resolve();
    releaseIdentity.resolve();
  }
});

test("sign-out removes the saved session before a slow logout, and reload stays signed out", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const started = deferred();
  const release = deferred();
  fixture.beforeLogout = async () => {
    started.resolve();
    await release.promise;
  };
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await started.promise;
    expect(await storedSession(page)).toBeNull();
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    expect(fixture.authRequests).toBe(1);
    expect(fixture.sessionUserRequests).toHaveLength(0);
  } finally {
    release.resolve();
  }
});

test("malformed stored session data is discarded without an authentication request", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await page.evaluate((key) => sessionStorage.setItem(key, "{not-json"), SESSION_KEY);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  expect(fixture.authRequests).toBe(0);
  expect(fixture.sessionUserRequests).toHaveLength(0);
  expect(fixture.identityRequests).toHaveLength(0);
});

for (const status of [400, 401, 403]) {
  test(`a rejected expired refresh token (HTTP ${status}) clears storage and returns to sign-in`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    await seedExpiredSession(page);
    fixture.authStatusForRequest = () => status;
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(`HTTP ${status}`);
    expect(await storedSession(page)).toBeNull();
    expect(refreshCalls(fixture)).toHaveLength(1);
    expect(fixture.identityRequests).toHaveLength(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });
}

for (const failure of ["server", "offline"]) {
  test(`a ${failure} restore failure retains the session for explicit retry without showing the workspace`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    const saved = await storedSession(page);
    const identityRequests = fixture.identityRequests.length;
    fixture.sessionUserStatus = failure === "server" ? 503 : 200;
    fixture.sessionUserNetworkFailure = failure === "offline";
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Could not restore your session:");
    await expect(page.getByRole("button", { name: "Retry session", exact: true })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    expect(await storedSession(page)).toEqual(saved);
    expect(fixture.identityRequests).toHaveLength(identityRequests);
    fixture.sessionUserStatus = 200;
    fixture.sessionUserNetworkFailure = false;
    await page.getByRole("button", { name: "Retry session", exact: true }).click();
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    expect(fixture.authRequests).toBe(1);
  });
}

test("an unauthorized saved access token gets one refresh fallback before server identity is loaded", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  fixture.sessionUserStatus = 401;
  await page.reload();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  expect(refreshCalls(fixture)).toHaveLength(1);
  expect(fixture.sessionUserRequests).toHaveLength(1);
  expect(await storedSession(page)).not.toBeNull();
});

test("reload uses a changed company assignment and never restores the previous company's rows", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  fixture.companyIds["member-a"] = "company-reassigned";
  fixture.prefixes["member-a"] = "REASSIGNED";
  const checking = deferred();
  const release = deferred();
  fixture.beforeRevisions = async () => {
    checking.resolve();
    await release.promise;
  };
  try {
    await page.reload();
    await checking.promise;
    await expect(restoring(page)).toBeVisible();
    await expect(page.getByText("ALPHA-001", { exact: true })).toHaveCount(0);
    release.resolve();
    await expect(rowWithSku(page, "REASSIGNED-001")).toBeVisible();
    await expect(page.locator("header")).toContainText("Company Reassigned");
    await expect(page.getByText("ALPHA-001", { exact: true })).toHaveCount(0);
    expect(fixture.authRequests).toBe(1);
  } finally {
    release.resolve();
  }
});

test("a late abandoned refresh cannot overwrite a different member's newly signed-in session", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await seedExpiredSession(page);
  const started = deferred();
  const release = deferred();
  fixture.beforeAuth = async ({ grantType }) => {
    if (grantType === "refresh_token") {
      started.resolve();
      await release.promise;
    }
  };
  fixture.authSessionForRequest = ({ grantType, user }) =>
    grantType === "refresh_token"
      ? {
          access_token: "late-member-a-access",
          refresh_token: "late-member-a-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: user, email: `${user}@example.test` },
        }
      : null;
  const lateResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token"
    );
  });
  try {
    await page.reload();
    await started.promise;
    await expect(restoring(page)).toBeVisible();
    await page.getByRole("button", { name: "Sign in instead", exact: true }).click();
    expect(await storedSession(page)).toBeNull();
    await signIn(page, "member-b");
    await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
    const memberBSession = await storedSession(page);
    expect(memberBSession.user.id).toBe("member-b");
    expect(memberBSession.access_token).toBe("token-member-b");
    release.resolve();
    const response = await lateResponse;
    expect(response.status()).toBe(200);
    await response.finished();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(rowWithSku(page, "BRAVO-001")).toBeVisible();
    await expect(page.locator("header")).toContainText("member-b@example.test");
    await expect(page.getByText("ALPHA-001", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await storedSession(page)).toEqual(memberBSession);
    expect(refreshCalls(fixture)).toHaveLength(1);
    expect(fixture.authRequests).toBe(2);
  } finally {
    release.resolve();
  }
});

test("a failed identity lookup retains rotated tokens and retry verifies the new access token without another refresh", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  await seedExpiredSession(page);
  fixture.authSessionForRequest = ({ user }) => ({
    access_token: "retained-rotated-access",
    refresh_token: "retained-rotated-refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: user, email: `${user}@example.test` },
  });
  fixture.revisionStatus = 503;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Could not restore your session:");
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(page.getByRole("tab")).toHaveCount(0);
  const rotated = await storedSession(page);
  expect(rotated.access_token).toBe("retained-rotated-access");
  expect(rotated.refresh_token).toBe("retained-rotated-refresh");
  expect(rotated.expires_at).toBeGreaterThan(
    await page.evaluate(() => Math.floor(Date.now() / 1000)),
  );
  expect(refreshCalls(fixture)).toHaveLength(1);
  expect(fixture.sessionUserRequests).toHaveLength(0);
  fixture.revisionStatus = 200;
  await page.getByRole("button", { name: "Retry session", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fixture.sessionUserRequests).toEqual([
    { user: "member-a", accessToken: "retained-rotated-access" },
  ]);
  expect(
    fixture.identityRequests.every(({ accessToken }) => accessToken === "retained-rotated-access"),
  ).toBe(true);
  expect(refreshCalls(fixture)).toHaveLength(1);
  expect(await storedSession(page)).toEqual(rotated);
});
