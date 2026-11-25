import type { Ref } from "react";
import { Group, NativeSelect } from "@mantine/core";
import marketplaces from "./generated/marketplaces.json";
import { reviewYears } from "./financial-review-view";

/** The review covers one marketplace (in its one currency) and one calendar year. */
export function FinancialReviewScope({
  marketplace,
  year,
  onChange,
  ref,
}: {
  marketplace: string;
  year: number;
  onChange: (patch: { marketplace?: string; year?: number }) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <Group
      ref={ref}
      tabIndex={-1}
      className="financial-review-scope"
      role="group"
      aria-label="Financial review scope"
      gap="sm"
      align="end"
    >
      <NativeSelect
        className="financial-review-marketplace-field"
        label="Marketplace"
        value={marketplace}
        data={marketplaces}
        onChange={(event) => {
          onChange({ marketplace: event.currentTarget.value });
        }}
      />
      <NativeSelect
        className="financial-review-year-field"
        label="Year"
        value={String(year)}
        data={reviewYears().map(String)}
        onChange={(event) => {
          onChange({ year: Number(event.currentTarget.value) });
        }}
      />
    </Group>
  );
}
