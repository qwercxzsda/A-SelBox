import { useRef, type KeyboardEvent } from "react";
import { AmountTrendPeriod } from "./AmountTrendPeriod";
import { AmountTrendAxis } from "./AmountTrendAxis";
import { chartPercentage } from "./amount-trend-format";
import "./AmountTrendPlot.css";

export interface AmountTrendSeries {
  id: string;
  color: string;
  dash: string;
  lines: string[];
}

export interface AmountTrendPoint {
  id: string;
  shortLabel: string;
  accessibleLabel: string;
  description: string;
  opensDialog?: boolean;
  amountY: number | null;
  lineY: number | null;
  segments: {
    id?: string;
    part?: "reported" | "serviceFee";
    familyId: string;
    top: number;
    height: number;
    lineY: number | null;
    description: string;
    actionLabel?: string;
  }[];
}

/** Shared financial chart: signed stacked period bars and period or cumulative lines. */
export function AmountTrendPlot({
  points,
  gapLabels = [],
  series,
  lines,
  zero,
  ticks,
  currency,
  inspectedId,
  onInspect,
  onSelect,
  onSelectSegment,
  showAxis = true,
  keyboardNavigation = false,
  onNavigate,
}: {
  points: readonly (AmountTrendPoint | null)[];
  gapLabels?: readonly string[];
  series: readonly AmountTrendSeries[];
  lines: readonly string[];
  zero: number;
  ticks: readonly { value: string; y: number }[];
  currency: string;
  inspectedId: string;
  onInspect: (id: string) => void;
  onSelect: (id: string) => void;
  onSelectSegment?: (id: string, groupId: string) => void;
  showAxis?: boolean;
  keyboardNavigation?: boolean;
  onNavigate?: (id: string) => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  function onNavigateKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!keyboardNavigation || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    const available = points.filter((point) => point !== null);
    const index = available.findIndex((point) => point.id === id);
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? available.length - 1
          : index + (event.key === "ArrowLeft" ? -1 : 1);
    event.preventDefault();
    const target = available.find((_, pointIndex) => pointIndex === targetIndex);
    if (!target) return;
    (onNavigate ?? onInspect)(target.id);
    const button = [
      ...(plot.current?.querySelectorAll<HTMLButtonElement>(".amount-trend-period") ?? []),
    ].find((element) => element.dataset.period === target.id);
    button?.focus({ preventScroll: true });
  }
  return (
    <div ref={plot} className="amount-trend-plot">
      {showAxis ? <AmountTrendAxis currency={currency} ticks={ticks} /> : null}
      <div className="amount-trend-zero-line" style={{ top: chartPercentage(zero) }} />
      <svg
        className="amount-trend-line"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {series.flatMap((entry) =>
          entry.lines.map((line, index) => (
            <polyline
              key={`${entry.id}:${String(index)}`}
              className="amount-trend-family-line"
              data-family-id={entry.id}
              points={line}
              fill="none"
              stroke={entry.color}
              strokeDasharray={entry.dash}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {lines.map((line, index) => (
          <polyline
            key={index}
            className="amount-trend-total-line"
            points={line}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {points.map((point, index) => {
        const position = {
          left: (index / points.length) * 100,
          width: 100 / points.length,
        };
        return point ? (
          <AmountTrendPeriod
            key={point.id}
            {...{
              point,
              position,
              zero,
              series,
              onInspect,
              onSelect,
              onSelectSegment,
              keyboardNavigation,
              onNavigateKey,
            }}
            inspected={point.id === inspectedId}
          />
        ) : (
          <span
            key={index}
            className="amount-trend-gap"
            style={{ left: chartPercentage(position.left), width: chartPercentage(position.width) }}
          >
            {gapLabels[index]}
          </span>
        );
      })}
    </div>
  );
}
