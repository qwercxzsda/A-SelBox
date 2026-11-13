import type { SkuConfigurationItem } from "./api";
import { AdditionalDetails } from "./AdditionalDetails";

/** Saved identity stays separate from editable assignment and period values. */
export function SkuConfigurationMetadata({ item }: { item: SkuConfigurationItem | null }) {
  if (!item || !(item.sku_id || item.terms_version_id || item.company_id)) return null;
  return (
    <AdditionalDetails
      stateKey={`fees:${item.sku}:metadata`}
      label="Additional fee details"
      rows={[
        { field: "SKU ID", value: item.sku_id },
        { field: "Company ID", value: item.company_id },
        { field: "Terms version ID", value: item.terms_version_id },
      ]}
    />
  );
}
