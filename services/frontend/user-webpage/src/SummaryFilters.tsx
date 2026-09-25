import { Fragment } from "react";
import "./SummaryFilters.css";

export interface SummaryFilter {
  label: "Company" | "SKU" | "Marketplace";
  values: string[];
}

export function SummaryFilters({
  filters,
  compact = false,
}: {
  filters: SummaryFilter[];
  compact?: boolean;
}) {
  const activeFilters = filters.filter((filter) => filter.values.length > 0);

  return (
    <section
      className="summary-filters"
      aria-label="Applied filters"
      data-compact={compact || undefined}
    >
      {activeFilters.length === 0 ? (
        <p>All transactions</p>
      ) : (
        <dl>
          {activeFilters.map(({ label, values }) => (
            <div key={label} className="summary-filter">
              <dt>{label}</dt>
              <dd>
                {compact && values.length > 2
                  ? `${String(values.length)} selected`
                  : values.map((value, index) => (
                      <Fragment key={`${String(index)}:${value}`}>
                        {index > 0 ? ", " : null}
                        <span>{value}</span>
                      </Fragment>
                    ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
