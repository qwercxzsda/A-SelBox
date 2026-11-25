import type { Identity } from "./auth-session.ts";
import { DATASET_PRESENTATION, companyLabel } from "./view-model.ts";

// Members see only the first group.
const TAB_GROUPS = [
  ["live", "inventory", "payouts", "fees", "assignments"],
  ["accounts", "companies"],
  ["raw-data", "financial-review"],
] as const;
export type WorkspaceTab = (typeof TAB_GROUPS)[number][number];

export function workspaceTabGroups(identity: Identity): readonly (readonly WorkspaceTab[])[] {
  return identity.account.access_role === "administrator" ? TAB_GROUPS : TAB_GROUPS.slice(0, 1);
}

export function tabLabel(tab: WorkspaceTab): string {
  if (tab === "inventory") return "Inventory";
  if (tab === "assignments") return "Assignments";
  if (tab === "companies") return "Companies";
  if (tab === "financial-review") return "Financial review";
  if (tab === "raw-data") return "Raw data";
  return DATASET_PRESENTATION[tab].label;
}

/** "<Tab> · <Administrator or the member's company> · A-SelBox". */
export function workspaceDocumentTitle(tab: WorkspaceTab, identity: Identity): string {
  const accountTitle =
    identity.account.access_role === "administrator"
      ? "Administrator"
      : companyLabel(
          identity.account.company_id,
          new Map(identity.companies.map(({ id, name }) => [id, name])),
        );
  return `${tabLabel(tab)} · ${accountTitle} · A-SelBox`;
}
