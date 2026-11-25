import type { CanonicalRow, TableDatasetKey } from "./api";
import type { Identity } from "./auth-session";
import { CompanyMembership } from "./CompanyMembership";
import { isRawReport } from "./raw-data-view";
import { RawRecordDrawer } from "./RawRecordDrawer";
import { RowDetail } from "./RowDetail";

/** The drawer a selected list row opens: membership editing, an Amazon report row, or a record. */
export function DatasetRecordDrawer({
  identity,
  dataset,
  row,
  companies,
  onClose,
  onSaved,
  onAddCompany,
  onShowTransactions,
}: {
  identity: Identity;
  dataset: TableDatasetKey;
  row: CanonicalRow | null;
  companies: Map<string, string>;
  onClose: () => void;
  onSaved: (notice: string) => void;
  onAddCompany?: () => void;
  onShowTransactions?: (sku: string) => void;
}) {
  const accessToken = identity.session.access_token;
  if (dataset === "accounts")
    return (
      <CompanyMembership
        accessToken={accessToken}
        companies={identity.companies}
        row={row}
        onAddCompany={onAddCompany}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  if (isRawReport(dataset))
    return (
      <RawRecordDrawer
        identity={identity}
        dataset={dataset}
        row={row}
        onClose={onClose}
        onShowTransactions={onShowTransactions}
      />
    );
  return (
    <RowDetail
      accessToken={accessToken}
      isAdministrator={identity.account.access_role === "administrator"}
      companies={companies}
      dataset={dataset}
      row={row}
      onShowTransactions={onShowTransactions}
      onClose={onClose}
    />
  );
}
