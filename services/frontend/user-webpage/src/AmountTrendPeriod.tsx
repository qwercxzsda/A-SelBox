import { VisuallyHidden } from "@mantine/core";
import { useId, type KeyboardEvent } from "react";
import { chartPercentage } from "./amount-trend-format";
import type { AmountTrendPoint, AmountTrendSeries } from "./AmountTrendPlot";

export function AmountTrendPeriod({
  point,
  position,
  zero,
  series,
  inspected,
  onInspect,
  onSelect,
  onSelectSegment,
  keyboardNavigation,
  onNavigateKey,
}: {
  point: AmountTrendPoint;
  position: { left: number; width: number };
  zero: number;
  series: readonly AmountTrendSeries[];
  inspected: boolean;
  onInspect: (id: string) => void;
  onSelect: (id: string) => void;
  onSelectSegment?: (id: string, groupId: string) => void;
  keyboardNavigation: boolean;
  onNavigateKey: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}) {
  const descriptionId = useId();
  const seriesById = new Map(series.map((entry) => [entry.id, entry]));
  return (
    <>
      <button
        type="button"
        className="amount-trend-period"
        style={{ left: chartPercentage(position.left), width: chartPercentage(position.width) }}
        data-period={point.id}
        tabIndex={keyboardNavigation ? (inspected ? 0 : -1) : undefined}
        aria-haspopup={point.opensDialog ? "dialog" : undefined}
        onKeyDown={(event) => {
          onNavigateKey(event, point.id);
        }}
        aria-label={point.accessibleLabel}
        aria-describedby={descriptionId}
        title={point.description}
        data-inspected={inspected || undefined}
        onFocus={() => {
          onInspect(point.id);
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") onInspect(point.id);
        }}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSelect(point.id);
        }}
      >
        {series.length ? (
          point.segments.map((segment, index) => {
            const entry = seriesById.get(segment.familyId);
            if (!entry) return null;
            return (
              <span key={segment.id ?? entry.id}>
                {onSelectSegment ? (
                  <VisuallyHidden id={`${descriptionId}-segment-${String(index)}`}>
                    {segment.description}
                  </VisuallyHidden>
                ) : null}
                <span
                  className="amount-trend-bar"
                  data-family-id={entry.id}
                  data-part={segment.part}
                  title={segment.description}
                  style={{
                    top: chartPercentage(segment.top),
                    height: chartPercentage(segment.height),
                    backgroundColor: entry.color,
                  }}
                  aria-hidden="true"
                />
                {segment.lineY !== null ? (
                  <span
                    className="amount-trend-family-dot"
                    data-family-id={entry.id}
                    style={{ top: chartPercentage(segment.lineY), backgroundColor: entry.color }}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            );
          })
        ) : point.amountY !== null ? (
          <span
            className="amount-trend-bar"
            style={{
              top: chartPercentage(Math.min(zero, point.amountY)),
              height: chartPercentage(Math.abs(zero - point.amountY)),
            }}
            aria-hidden="true"
          />
        ) : null}
        {point.lineY !== null ? (
          <span
            className="amount-trend-dot"
            style={{ top: chartPercentage(point.lineY) }}
            aria-hidden="true"
          />
        ) : null}
        <span className="amount-trend-period-label">{point.shortLabel}</span>
        <VisuallyHidden component="span" id={descriptionId}>
          {point.description}
        </VisuallyHidden>
      </button>
      {onSelectSegment
        ? point.segments.map((segment, index) =>
            segment.height > 0 ? (
              <button
                key={segment.id ?? segment.familyId}
                type="button"
                className="amount-trend-segment-action"
                data-family-id={segment.familyId}
                data-part={segment.part}
                data-period={point.id}
                tabIndex={keyboardNavigation ? -1 : undefined}
                aria-haspopup={point.opensDialog ? "dialog" : undefined}
                aria-describedby={`${descriptionId}-segment-${String(index)}`}
                onKeyDown={(event) => {
                  onNavigateKey(event, point.id);
                }}
                aria-label={segment.actionLabel ?? segment.description}
                title={segment.description}
                style={{
                  left: chartPercentage(position.left + position.width / 2),
                  width: `min(24px, ${chartPercentage(position.width * 0.42)})`,
                  top: chartPercentage(segment.top),
                  height: chartPercentage(segment.height),
                }}
                onFocus={() => {
                  onInspect(point.id);
                }}
                onPointerMove={(event) => {
                  if (event.pointerType !== "touch") onInspect(point.id);
                }}
                onClick={() => {
                  onSelectSegment(point.id, segment.familyId);
                }}
              />
            ) : null,
          )
        : null}
    </>
  );
}
