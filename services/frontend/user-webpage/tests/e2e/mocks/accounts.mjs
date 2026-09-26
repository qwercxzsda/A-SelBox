import { contentRange } from "./http.mjs";

export const ACCOUNT_PATHS = new Set([
  "/auth/v1/token",
  "/auth/v1/logout",
  "/auth/v1/user",
  "/rest/v1/rpc/workspace_revisions",
  "/rest/v1/companies",
  "/rest/v1/company_skus",
]);

export function createAccountHandlers(fixture) {
  const accessTokenUsers = new Map();
  const refreshTokenUsers = new Map();
  return {
    userForToken: (token) =>
      accessTokenUsers.get(token) ?? token?.replace(/^token-/, "") ?? "member-a",
    async respond({ request, url, accessToken, user, route, reply, track }) {
      if (url.pathname === "/auth/v1/token") {
        fixture.authRequests += 1;
        const body = request.postDataJSON();
        const signedInUser =
          body.email?.split("@")[0] ??
          refreshTokenUsers.get(body.refresh_token) ??
          body.refresh_token.replace("refresh-", "");
        const entry = {
          grantType: url.searchParams.get("grant_type"),
          user: signedInUser,
          refreshToken: body.refresh_token ?? null,
        };
        fixture.authCalls.push(entry);
        await fixture.beforeAuth(entry);
        const status = fixture.authStatusForRequest(entry);
        if (status !== 200) return reply({ message: "Session fixture unavailable" }, status);
        const session = fixture.authSessionForRequest?.(entry) ?? {
          access_token: `token-${signedInUser}`,
          refresh_token: `refresh-${signedInUser}`,
          token_type: "bearer",
          expires_in: 3600,
          user: { id: signedInUser, email: `${signedInUser}@example.test` },
        };
        accessTokenUsers.set(session.access_token, signedInUser);
        refreshTokenUsers.set(session.refresh_token, signedInUser);
        return reply(session);
      }
      if (url.pathname === "/auth/v1/logout") {
        fixture.logoutRequests += 1;
        await fixture.beforeLogout();
        return reply({});
      }
      if (url.pathname === "/auth/v1/user") {
        const entry = { user, accessToken };
        fixture.sessionUserRequests.push(entry);
        await fixture.beforeSessionUser(entry);
        if (fixture.sessionUserNetworkFailure) return route.abort("internetdisconnected");
        if (fixture.sessionUserStatus !== 200)
          return reply({ message: "Session user fixture unavailable" }, fixture.sessionUserStatus);
        return reply({ id: user, email: `${user}@example.test` });
      }
      if (url.pathname === "/rest/v1/rpc/workspace_revisions") {
        const sources = (url.searchParams.get("p_sources") ?? "{settlement,data_kiosk,fees}")
          .replace(/[{}]/g, "")
          .split(",")
          .filter(Boolean);
        const role = fixture.roles[user];
        const revisionValues = fixture.revisionsByUser[user] ?? fixture.revisions;
        const response = {
          account: role
            ? {
                user_id: user,
                access_role: role,
                company_id: role === "operator" ? null : fixture.companyIds[user],
              }
            : null,
          revisions: Object.fromEntries(sources.map((source) => [source, revisionValues[source]])),
        };
        const entry = { user, accessToken, sources, response, completed: false, failure: null };
        fixture.revisionRequests.push(entry);
        track(request, entry);
        await fixture.beforeRevisions(entry);
        if (fixture.revisionNetworkFailure) return route.abort("internetdisconnected");
        if (!role) return reply({ message: "Account fixture unavailable" }, 403);
        const status = fixture.revisionStatusForRequest?.(entry) ?? fixture.revisionStatus;
        if (status !== 200) return reply({ message: "Revision fixture unavailable" }, status);
        return reply(response);
      }
      if (["/rest/v1/companies", "/rest/v1/company_skus"].includes(url.pathname)) {
        fixture.identityRequests.push({
          user,
          accessToken,
          endpoint: url.pathname,
          params: url.searchParams,
        });
      }
      if (url.pathname === "/rest/v1/companies") {
        await fixture.beforeCompanies({ user, accessToken });
        if (fixture.companiesStatus !== 200)
          return reply({ message: "Companies fixture unavailable" }, fixture.companiesStatus);
        const companies =
          fixture.roles[user] === "operator"
            ? Object.entries(fixture.companyNames).map(([id, name]) => ({ id, name }))
            : [
                {
                  id: fixture.companyIds[user],
                  name: fixture.companyNames[fixture.companyIds[user]],
                },
              ];
        return reply(companies, 200, {
          "Content-Range": contentRange(companies.length, companies.length),
        });
      }
      if (url.pathname === "/rest/v1/company_skus") {
        await fixture.beforeAssignments({ user, accessToken });
        if (fixture.assignmentsStatus !== 200)
          return reply({ message: "Assignments fixture unavailable" }, fixture.assignmentsStatus);
        const offset = Number(url.searchParams.get("offset"));
        const rows = fixture.assignments.slice(
          offset,
          offset + Number(url.searchParams.get("limit")),
        );
        return reply(rows, 200, {
          "Content-Range": contentRange(rows.length, fixture.assignments.length, offset),
        });
      }

      throw new Error(`Unexpected account request: ${url.pathname}`);
    },
  };
}
