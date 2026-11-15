import { Title } from "@mantine/core";
import type { ReactNode } from "react";
import { HelpPopover } from "./HelpPopover";
import { LoadingStatus } from "./LoadingStatus";
import { SummaryFilters, type SummaryFilter } from "./SummaryFilters";

export function TransactionSummaryHeading({
  title,
  count,
  loading,
  controls,
  help,
  appliedFilters,
}: {
  title: string;
  count: number;
  loading: boolean;
  controls: ReactNode;
  help: ReactNode;
  appliedFilters: SummaryFilter[];
}) {
  return (
    <>
      <div className="totals-heading">
        <div className="totals-heading-title">
          <Title order={3} className="totals-section-title">
            {title}
          </Title>
          <HelpPopover label={`${title} help`}>{help}</HelpPopover>
          <span className="totals-market-count">
            {count} {count === 1 ? "marketplace" : "marketplaces"}
          </span>
          <LoadingStatus state={loading ? "updating" : null} />
        </div>
        {controls}
      </div>
      {appliedFilters.length > 0 ? (
        <div className="totals-scope">
          <SummaryFilters filters={appliedFilters} compact />
        </div>
      ) : null}
    </>
  );
}
