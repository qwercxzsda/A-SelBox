import type { TableDatasetKey } from "./api";
import { DATASET_PRESENTATION } from "./view-model";

export function DatasetHelp({ dataset }: { dataset: TableDatasetKey }) {
  return (
    <>
      <p>{DATASET_PRESENTATION[dataset].description}</p>
      {dataset === "finances" ? (
        <>
          <p>
            Included entries count as activity, including funds still held by Amazon. Linked
            releases and bank transfers are excluded. A released status alone does not exclude a
            directly posted fee.
          </p>
          <p>Find by transaction ID searches all retained captures, regardless of table filters.</p>
        </>
      ) : null}
      {dataset === "payouts" ? (
        <p>
          Latest marks the newest saved version for each company, month, marketplace, and currency.
          Show versions opens earlier snapshots. Saved amounts retain their original inputs.
        </p>
      ) : null}
      <p>
        Use column headings to filter or sort. Select a row, or press Enter on it, to open details.
        The column arrows move wide tables horizontally.
      </p>
    </>
  );
}
