import type { CanonicalRow } from "./api";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";

/** Shared disclosure and field/value presentation for saved record metadata. */
export function AdditionalDetails({
  stateKey,
  rows,
  label = "Additional record details",
}: {
  stateKey: string;
  rows: CanonicalRow[];
  label?: string;
}) {
  return (
    <DetailSection
      title="Additional details"
      stateKey={stateKey}
      collapsible
      description="Saved identifiers and metadata for this record."
    >
      <DetailTable
        label={label}
        className="record-metadata-table"
        columns={[
          { key: "field", label: "Field" },
          { key: "value", label: "Value" },
        ]}
        rows={rows}
        rowKey={(row) => row.field ?? ""}
        minWidth={0}
      />
    </DetailSection>
  );
}
