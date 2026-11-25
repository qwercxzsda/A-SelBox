import { useEffect, type RefObject } from "react";
import { Alert, Stack, Text } from "@mantine/core";
import { assignmentKey, type Assignment } from "./api/assignment-types";
import type { Identity } from "./auth-session";
import { AdditionalDetails } from "./AdditionalDetails";
import { regionLabel } from "./amazon-codes";
import { AssignmentHistory } from "./AssignmentHistory";
import {
  ASSIGNMENT_KIND_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  assignmentOriginText,
  assignmentStatus,
} from "./assignments-view";
import { DetailFields, type DetailField } from "./DetailFields";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { companyLabel } from "./view-model";

const WARNING_TEXT = {
  NO_ASSIGNMENT: "Choose a company.",
  PRODUCTS_DISAGREE: "A product belongs to another company.",
} as const;

/** The drawer context names the ID; a warning appears once, as the alert below the facts. */
function assignmentFacts(row: Assignment, companies: Map<string, string>) {
  // Members receive no origin, so "Last change" is an administrator fact.
  const origin = assignmentOriginText(row);
  const fields: DetailField[] = [
    { key: "source", label: "Source", value: ASSIGNMENT_KIND_LABELS[row.kind] },
    { key: "company", label: "Company", value: companyLabel(row.companyId, companies) },
    { key: "marketplace", label: "Marketplace", value: row.marketplaceNames.join(", ") || "—" },
  ];
  if (origin) fields.push({ key: "origin", label: "Last change", value: origin });
  return fields;
}

function ProductOwnership({
  row,
  companies,
  onShowTransactions,
}: {
  row: Assignment;
  companies: Map<string, string>;
  onShowTransactions: (sku: string) => void;
}) {
  return (
    <DetailSection
      title="Product ownership"
      actions={
        <Text size="sm" c="dimmed">
          {row.products.length.toLocaleString("en-US")}
        </Text>
      }
    >
      {row.products.length ? (
        <DetailTable
          label="Product ownership"
          // Phones scroll the table sideways rather than splitting SKUs and ASINs.
          minWidth={480}
          columns={[
            { key: "sku", label: "SKU", empty: "Unresolved" },
            { key: "asin", label: "ASIN" },
            { key: "company", label: "Company" },
          ]}
          rows={row.products.map((product, index) => ({
            position: String(index),
            sku: product.sku,
            asin: product.asin,
            company: companyLabel(product.companyId, companies),
          }))}
          rowKey={(product) => product.position ?? ""}
          renderCell={(product, column) =>
            column.key === "sku" && product.sku ? (
              <SkuTransactionLink sku={product.sku} onShowTransactions={onShowTransactions} />
            ) : undefined
          }
        />
      ) : (
        <Text size="sm" c="dimmed">
          Amazon reports no products for this ID
        </Text>
      )}
    </DetailSection>
  );
}

/** Read-only facts for everyone; administrators also review products, history and metadata. */
export function AssignmentDetails({
  row,
  identity,
  companies,
  editButtonRef,
  onShowTransactions,
}: {
  row: Assignment;
  identity: Identity;
  companies: Map<string, string>;
  /** Edit sits in the drawer header (administrators only). */
  editButtonRef: RefObject<HTMLButtonElement | null>;
  onShowTransactions: (sku: string) => void;
}) {
  const administrator = identity.account.access_role === "administrator";
  useEffect(() => {
    // Returning from the editor replaces the focused content; continue from Edit.
    if (document.activeElement === document.body)
      editButtonRef.current?.focus({ preventScroll: true });
  }, [editButtonRef]);
  return (
    <Stack gap={0} className="assignment-details editing-drawer-details drawer-panel-enter">
      <Stack gap="lg">
        <DetailFields fields={assignmentFacts(row, companies)} />
        {administrator && row.warning ? (
          <Alert color="orange" title={ASSIGNMENT_STATUS_LABELS[assignmentStatus(row)]}>
            {WARNING_TEXT[row.warning]}
          </Alert>
        ) : null}
      </Stack>
      {administrator ? (
        <>
          <ProductOwnership
            row={row}
            companies={companies}
            onShowTransactions={onShowTransactions}
          />
          {row.keyId && row.versionId ? (
            <AssignmentHistory
              identity={identity}
              keyId={row.keyId}
              versionId={row.versionId}
              companies={companies}
            />
          ) : null}
          <AdditionalDetails
            stateKey={`assignment:${assignmentKey(row)}:metadata`}
            label="Additional assignment details"
            rows={[
              { field: "Seller account", value: row.sellerNamespace },
              { field: "Region", value: regionLabel(row.amazonScope) },
              { field: "Source", value: row.kind },
              { field: "Assignment key ID", value: row.keyId },
              { field: "Assignment version ID", value: row.versionId },
              { field: "Company ID", value: row.companyId },
              { field: "Suggested company ID", value: row.suggestedCompanyId },
            ]}
          />
        </>
      ) : null}
    </Stack>
  );
}
