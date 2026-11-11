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
            releases and bank transfers are exclusive. A released status alone does not exclude a
            directly posted fee.
          </p>
          <p>Find by transaction ID searches all retained captures, regardless of table filters.</p>
        </>
      ) : null}
      {dataset === "data_kiosk" ? (
        <p>
          Dates use UTC and represent the end of each reported marketplace day. Retained source
          records support comparison; Transactions applies the company allocation rules.
        </p>
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
