import { contentRange } from "./http.mjs";

export const ACCOUNT_PATHS = new Set([
  "/auth/v1/token",
  "/auth/v1/logout",
  "/auth/v1/user",
  "/rest/v1/rpc/workspace_revisions",
  "/rest/v1/rpc/set_company_membership",
  "/rest/v1/rpc/create_company",
  "/rest/v1/rpc/delete_company",
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
        const sources = (
          url.searchParams.get("p_sources") ?? "{settlement,data_kiosk,fees,inventory}"
        )
          .replace(/[{}]/g, "")
          .split(",")
          .filter(Boolean);
        const role = fixture.roles[user];
        const revisionValues = { ...fixture.revisions, ...fixture.revisionsByUser[user] };
        const response = {
          account: role
            ? {
                user_id: user,
                access_role: role,
                company_id: role === "member" ? fixture.companyIds[user] : null,
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
      if (url.pathname === "/rest/v1/rpc/set_company_membership") {
        const body = request.postDataJSON();
        const entry = { user, body };
        fixture.membershipRequests.push(entry);
        await fixture.beforeMembership(entry);
        if (fixture.membershipStatus !== 200)
          return reply(
            { message: "Membership update unavailable", ...fixture.membershipError },
            fixture.membershipStatus,
          );
        const target = body.target_user_id;
        if (fixture.roles[user] !== "administrator" || fixture.roles[target] === "administrator")
          return reply({ message: "Administrator access cannot be changed here" }, 403);
        if (
          body.expected_access_role !== fixture.roles[target] ||
          body.expected_company_id !==
            (fixture.roles[target] === "member" ? fixture.companyIds[target] : null)
        )
          return reply({ message: "The user's membership has changed" }, 409);
        const company = body.target_company_id;
        fixture.roles[target] = company === null ? "unassigned" : "member";
        fixture.companyIds[target] = company;
        return reply([
          {
            user_id: target,
            access_role: fixture.roles[target],
            company_id: company,
            created_at: "2026-09-01T00:00:00Z",
          },
        ]);
      }
      if (url.pathname === "/rest/v1/rpc/create_company") {
        const body = request.postDataJSON();
        const entry = { user, body };
        fixture.companyCreationRequests.push(entry);
        await fixture.beforeCompanyCreation(entry);
        if (fixture.roles[user] !== "administrator")
          return reply({ message: "Administrator access required" }, 403);
        if (fixture.companyCreationStatus !== 200)
          return reply({ message: "Company creation unavailable" }, fixture.companyCreationStatus);
        const name = body.company_name.trim();
        if (!name) return reply({ message: "A company name is required" }, 400);
        const existing = Object.entries(fixture.companyNames).find(
          ([, candidate]) => candidate.toLowerCase() === name.toLowerCase(),
        );
        const id =
          existing?.[0] ??
          `0198b50b-701a-7000-8000-${String(900 + fixture.companyCreationRequests.length).padStart(12, "0")}`;
        const result = { id, name: existing?.[1] ?? name, created: !existing };
        fixture.companyNames[id] = result.name;
        entry.result = result;
        // Simulate a committed insert whose response was lost; a retry must reuse that company.
        if (fixture.companyCreationNetworkFailure) return route.abort("internetdisconnected");
        return reply([result]);
      }
      if (url.pathname === "/rest/v1/rpc/delete_company") {
        const body = request.postDataJSON();
        const entry = { user, body };
        fixture.companyDeletionRequests.push(entry);
        await fixture.beforeCompanyDeletion(entry);
        if (fixture.roles[user] !== "administrator")
          return reply({ message: "Administrator access required" }, 403);
        if (fixture.companyDeletionStatus !== 200)
          return reply({ message: "Private deletion failure" }, fixture.companyDeletionStatus);
        const id = body.target_company_id;
        const blockers = fixture.companyDeletionBlockers[id] ?? [];
        if (blockers.length)
          return reply(
            {
              code: "PT409",
              message: "Company cannot be deleted while it has linked records",
              details: JSON.stringify(blockers),
              hint: null,
            },
            409,
          );
        const result = { id, deleted: Object.hasOwn(fixture.companyNames, id) };
        delete fixture.companyNames[id];
        entry.result = result;
        if (fixture.companyDeletionNetworkFailure) return route.abort("internetdisconnected");
        return reply([result]);
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
          fixture.companyCatalogRows ??
          (fixture.roles[user] === "administrator"
            ? Object.entries(fixture.companyNames).map(([id, name]) => ({ id, name }))
            : fixture.roles[user] === "unassigned"
              ? []
              : [
                  {
                    id: fixture.companyIds[user],
                    name: fixture.companyNames[fixture.companyIds[user]],
                  },
                ]);
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
