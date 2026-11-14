import { Button, Text } from "@mantine/core";
import { useId, useState } from "react";
import { compareAbsoluteDecimals } from "./decimal";
import type { ReviewChartFamily, ReviewChartPoint } from "./financial-review-chart";
import { chartFamilyScopeLabel, chartFamilyScopeOrder } from "./financial-review-chart-context";

const COMPACT_FAMILIES = 6;

export function FinancialReviewChartLegend({
  families,
  latest,
}: {
  families: ReviewChartFamily[];
  latest: ReviewChartPoint;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const balances = new Map(
    latest.segments.map((segment) => [segment.familyId, segment.runningSourceGap]),
  );
  const ordered = [...families].sort(
    (left, right) =>
      chartFamilyScopeOrder(left) - chartFamilyScopeOrder(right) ||
      compareAbsoluteDecimals(balances.get(right.id) ?? "0", balances.get(left.id) ?? "0") ||
      left.label.localeCompare(right.label),
  );
  const visible = expanded ? ordered : ordered.slice(0, COMPACT_FAMILIES);
  return (
    <div className="financial-review-chart-legend">
      <ul id={listId} className="financial-review-family-legend" aria-label="Type family legend">
        {visible.map((family) => (
          <li key={family.id} data-family-id={family.id} title={family.comparisonNote}>
            <span
              className="financial-review-family-swatch"
              style={{ backgroundColor: family.color }}
              aria-hidden="true"
            />
            <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                stroke={family.color}
                strokeWidth="2"
                strokeDasharray={family.dash}
              />
            </svg>
            <span>
              <span>{family.label}</span>
              {chartFamilyScopeLabel(family) ? (
                <small className="financial-review-chart-context">
                  {" "}
                  · {chartFamilyScopeLabel(family)}
                </small>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {families.length > COMPACT_FAMILIES ? (
        <div className="financial-review-chart-legend-actions">
          <Text size="xs" c="dimmed">
            {expanded
              ? `All ${String(families.length)} families are shown.`
              : `Showing ${String(visible.length)} of ${String(families.length)} families, comparable scopes first. All ${String(families.length)} are plotted.`}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Show fewer families" : `Show all ${String(families.length)} families`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
