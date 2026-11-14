import { Button, Group, NativeSelect, Text } from "@mantine/core";
import { useId, useState } from "react";
import { formatRecordMonth } from "./date-display";
import { compareAbsoluteDecimals, formatAmount } from "./decimal";
import type { ReviewChartFamily, ReviewChartPoint } from "./financial-review-chart";
import { chartFamilyScopeLabel, chartFamilyScopeOrder } from "./financial-review-chart-context";

const COMPACT_VALUES = 3;

function SourceGapValues({
  monthly,
  running,
  totals = false,
}: {
  monthly: string | null;
  running: string | null;
  totals?: boolean;
}) {
  return (
    <dl className={totals ? "financial-review-chart-value-totals" : undefined}>
      {(
        [
          ["Monthly", monthly],
          ["Running", running],
        ] as const
      ).map(([label, amount]) => (
        <div key={label}>
          <dt>
            {label}
            {totals ? " source gap" : " gap contribution"}
          </dt>
          <dd>{formatAmount(amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FinancialReviewChartValues({
  point,
  points,
  families,
  currency,
  onInspect,
  onSelect,
}: {
  point: ReviewChartPoint;
  points: ReviewChartPoint[];
  families: ReviewChartFamily[];
  currency: string;
  onInspect: (month: string) => void;
  onSelect: (month: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const valuesId = useId();
  const familyById = new Map(families.map((family) => [family.id, family]));
  const ordered = [...point.segments].sort(
    (left, right) =>
      chartFamilyScopeOrder(familyById.get(left.familyId)) -
        chartFamilyScopeOrder(familyById.get(right.familyId)) ||
      compareAbsoluteDecimals(right.sourceGap, left.sourceGap) ||
      compareAbsoluteDecimals(right.runningSourceGap, left.runningSourceGap) ||
      (familyById.get(left.familyId)?.label ?? left.familyId).localeCompare(
        familyById.get(right.familyId)?.label ?? right.familyId,
      ),
  );
  const visible = expanded ? ordered : ordered.slice(0, COMPACT_VALUES);
  const month = point.month;
  return (
    <section className="financial-review-chart-values" aria-label="Chart values">
      <Group
        justify="flex-start"
        align="end"
        gap="sm"
        className="financial-review-chart-value-controls"
      >
        <NativeSelect
          label="Chart month"
          value={month}
          data={points.map(({ month }) => ({
            value: month,
            label: formatRecordMonth(month),
          }))}
          onChange={(event) => {
            onInspect(event.currentTarget.value);
          }}
        />
        <Button
          size="xs"
          variant="light"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onSelect(month);
          }}
        >
          Open month details
        </Button>
      </Group>
      <Text size="sm" c="dimmed" mt="xs">
        {currency}
      </Text>
      <SourceGapValues
        monthly={point.row.difference}
        running={point.row.running_difference}
        totals
      />
      {ordered.length ? (
        <>
          <div
            id={valuesId}
            className="financial-review-chart-family-values"
            data-expanded={expanded || undefined}
            role="group"
            aria-label="Family chart values"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Expanded values need a keyboard scroll target.
            tabIndex={expanded ? 0 : undefined}
          >
            {visible.map((segment) => {
              const family = familyById.get(segment.familyId);
              const context = chartFamilyScopeLabel(family);
              return (
                <div
                  key={segment.familyId}
                  className="financial-review-chart-family-value"
                  data-family-id={segment.familyId}
                  title={family?.comparisonNote}
                >
                  <Text size="xs" fw={600} className="financial-review-chart-family-name">
                    <span
                      className="financial-review-family-swatch"
                      style={{ backgroundColor: family?.color }}
                      aria-hidden="true"
                    />
                    <span>{family?.label ?? segment.familyId}</span>
                    {context ? (
                      <small className="financial-review-chart-context">{context}</small>
                    ) : null}
                  </Text>
                  <SourceGapValues monthly={segment.sourceGap} running={segment.runningSourceGap} />
                </div>
              );
            })}
          </div>
          {ordered.length > 1 ? (
            <div
              className={`financial-review-chart-legend-actions${ordered.length <= COMPACT_VALUES ? " financial-review-chart-values-toggle-compact" : ""}`}
            >
              <Text size="xs" c="dimmed">
                {expanded ? (
                  `All ${String(ordered.length)} family values.`
                ) : (
                  <>
                    Showing{" "}
                    <span className="financial-review-chart-family-count-wide">
                      {String(visible.length)}
                    </span>
                    <span className="financial-review-chart-family-count-phone">1</span> of{" "}
                    {String(ordered.length)} family contributions, comparable scopes first.
                  </>
                )}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                aria-expanded={expanded}
                aria-controls={valuesId}
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                {expanded
                  ? "Show fewer family values"
                  : `Show all ${String(ordered.length)} family values`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
