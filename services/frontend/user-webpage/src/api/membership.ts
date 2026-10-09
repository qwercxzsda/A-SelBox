import type { ApiTransport } from "./transport.ts";
import type { AppAccount } from "./types.ts";
import { parseAppAccount } from "./workspace.ts";
import { parseSingleObjectRow, requireUuid } from "./validation.ts";

export interface SetCompanyMembershipOptions {
  accessToken: string;
  account: AppAccount;
  companyId: string | null;
}

export function createMembershipApi({ postRpc }: ApiTransport) {
  return {
    async setCompanyMembership({
      accessToken,
      account,
      companyId,
    }: SetCompanyMembershipOptions): Promise<AppAccount> {
      requireUuid(account.user_id, "user");
      if (companyId !== null) requireUuid(companyId, "company");
      if (account.access_role === "administrator")
        throw new Error("Administrator access is managed by the database manager.");
      const row = parseSingleObjectRow(
        await postRpc(
          accessToken,
          "set_company_membership",
          {
            target_user_id: account.user_id,
            target_company_id: companyId,
            expected_access_role: account.access_role,
            expected_company_id: account.company_id,
          },
          "Company membership",
        ),
        "Company membership",
      );
      const updated = parseAppAccount(row, account.user_id);
      if (
        updated.company_id !== companyId ||
        updated.access_role !== (companyId === null ? "unassigned" : "member")
      ) {
        throw new Error("Company membership returned an unexpected assignment");
      }
      return updated;
    },
  };
}
