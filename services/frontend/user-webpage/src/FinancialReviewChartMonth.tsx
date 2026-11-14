import { VisuallyHidden } from "@mantine/core";
import { useId, type CSSProperties } from "react";
import { formatRecordMonth } from "./date-display";
import { formatMoney } from "./decimal";
import { chartPercentage } from "./financial-review-chart-format";
import { chartFamilyScopeLabel } from "./financial-review-chart-context";
import type {
  ReviewChartPoint,
  ReviewChartFamily,
  ReviewFamilySegment,
} from "./financial-review-chart";

function familyDescription(
  family: ReviewChartFamily | undefined,
  point: ReviewFamilySegment,
  currency: string,
): string {
  const label = family?.label ?? point.familyId;
  const context = chartFamilyScopeLabel(family);
  const scope = context ? ` · ${context}` : "";
  return `${label}${scope}: Monthly gap contribution ${formatMoney(point.sourceGap, currency)}; Running gap contribution ${formatMoney(point.runningSourceGap, currency)}`;
}

export function FinancialReviewChartMonth({
  point,
  shortLabel,
  position,
  currency,
  zero,
  families,
  inspected,
  onInspect,
  onSelect,
}: {
  point: ReviewChartPoint;
  shortLabel: string;
  position: CSSProperties;
  currency: string;
  zero: number;
  families: ReviewChartFamily[];
  inspected: boolean;
  onInspect: (month: string) => void;
  onSelect: (month: string) => void;
}) {
  const descriptionId = useId();
  const familyById = new Map(families.map((family) => [family.id, family]));
  const month = point.month;
  const label = formatRecordMonth(month);
  const description = [
    `${label}: Monthly source gap ${formatMoney(point.row.difference, currency)}; Running source gap ${formatMoney(point.row.running_difference, currency)}`,
    ...point.segments.map((segment) =>
      familyDescription(familyById.get(segment.familyId), segment, currency),
    ),
  ].join("\n");
  return (
    <button
      type="button"
      className="financial-review-trend-month"
      style={position}
      aria-label={`${shortLabel}: View chart details for ${label}`}
      aria-describedby={descriptionId}
      title={description}
      data-inspected={inspected || undefined}
      onFocus={() => {
        onInspect(month);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onInspect(month);
      }}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        onSelect(month);
      }}
    >
      {families.length ? (
        point.segments.map((segment) => {
          const family = familyById.get(segment.familyId);
          if (!family) return null;
          return (
            <span key={family.id}>
              <span
                className="financial-review-trend-bar"
                data-family-id={family.id}
                title={familyDescription(family, segment, currency)}
                style={{
                  top: chartPercentage(segment.top),
                  height: chartPercentage(segment.height),
                  backgroundColor: family.color,
                }}
                aria-hidden="true"
              />
              <span
                className="financial-review-family-dot"
                data-family-id={family.id}
                style={{ top: chartPercentage(segment.runningY), backgroundColor: family.color }}
                aria-hidden="true"
              />
            </span>
          );
        })
      ) : (
        <span
          className="financial-review-trend-bar"
          style={{
            top: chartPercentage(Math.min(zero, point.monthlyY)),
            height: chartPercentage(Math.abs(zero - point.monthlyY)),
          }}
          aria-hidden="true"
        />
      )}
      <span
        className="financial-review-trend-dot"
        style={{ top: chartPercentage(point.runningY) }}
        aria-hidden="true"
      />
      <span className="financial-review-trend-month-label">{shortLabel}</span>
      <VisuallyHidden component="span" id={descriptionId}>
        {description}
      </VisuallyHidden>
    </button>
  );
}
