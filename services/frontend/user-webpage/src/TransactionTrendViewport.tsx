import { Button, Group, Text, VisuallyHidden } from "@mantine/core";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AmountTrendAxis } from "./AmountTrendAxis";
import { AmountTrendPlot, type AmountTrendPoint } from "./AmountTrendPlot";
import type { projectTransactionTrend } from "./transaction-trend-chart";

export interface TrendRevealRequest {
  id: string;
  revision: number;
}

function revealPeriod(element: HTMLDivElement, id: string) {
  const point = [...element.querySelectorAll<HTMLButtonElement>(".amount-trend-period")].find(
    (entry) => entry.dataset.period === id,
  );
  if (!point) return;
  const viewport = element.getBoundingClientRect();
  const bounds = point.getBoundingClientRect();
  const inset = Math.min(28, element.clientWidth / 4);
  const left =
    bounds.left < viewport.left + inset
      ? bounds.left - viewport.left - inset
      : bounds.right > viewport.right - inset
        ? bounds.right - viewport.right + inset
        : 0;
  if (left) element.scrollBy({ left, behavior: "instant" });
}

export function TransactionTrendViewport({
  chart,
  points,
  currency,
  scope,
  periodName,
  inspectedId,
  revealRequest,
  onInspect,
  onNavigate,
  onSelect,
  onSelectSegment,
}: {
  chart: NonNullable<ReturnType<typeof projectTransactionTrend>>;
  points: AmountTrendPoint[];
  currency: string;
  scope: string;
  periodName: "day" | "week";
  inspectedId: string;
  revealRequest: TrendRevealRequest | null;
  onInspect: (id: string) => void;
  onNavigate: (id: string) => void;
  onSelect: (id: string) => void;
  onSelectSegment: (id: string, groupId: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  const instructionId = useId();
  const [position, setPosition] = useState({
    overflow: false,
    start: true,
    end: true,
    labelStep: Math.max(1, Math.ceil(points.length / 10)),
  });
  const firstPeriod = points[0]?.id;
  const lastPeriod = points.at(-1)?.id;
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const update = () => {
      const remaining = element.scrollWidth - element.clientWidth;
      const plotWidth =
        element.querySelector(".amount-trend-plot")?.clientWidth ?? element.clientWidth;
      const minimumSlots = points.length > 1 && plotWidth >= 100 ? 2 : 1;
      const labelSlots = Math.max(minimumSlots, Math.min(12, Math.floor(plotWidth / 76)));
      const next = {
        labelStep: Math.max(1, Math.ceil(points.length / labelSlots)),
        overflow: remaining > 1,
        start: element.scrollLeft < 1,
        end: element.scrollLeft >= remaining - 1,
      };
      setPosition((current) =>
        current.overflow === next.overflow &&
        current.start === next.start &&
        current.end === next.end &&
        current.labelStep === next.labelStep
          ? current
          : next,
      );
    };
    let previousWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== previousWidth) {
        previousWidth = element.clientWidth;
        const selected = element.querySelector<HTMLButtonElement>(
          ".amount-trend-period[data-inspected]",
        );
        if (selected?.dataset.period) revealPeriod(element, selected.dataset.period);
      }
      update();
    });
    observer.observe(element);
    const canvas = element.querySelector(".transaction-trend-canvas");
    if (canvas) observer.observe(canvas);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, [points.length]);
  useLayoutEffect(() => {
    const element = target.current;
    const id = revealRequest?.id ?? lastPeriod;
    if (!element || !id) return;
    revealPeriod(element, id);
  }, [revealRequest, firstPeriod, lastPeriod]);
  const labeledPoints = points.map((point, index) => ({
    ...point,
    shortLabel:
      index === points.length - 1 ||
      (index % position.labelStep === 0 && points.length - 1 - index >= position.labelStep)
        ? point.shortLabel
        : "",
  }));
  function scroll(direction: number) {
    const element = target.current;
    if (element)
      element.scrollBy({ left: direction * element.clientWidth * 0.75, behavior: "instant" });
  }
  return (
    <>
      {position.overflow ? (
        <Group
          className="transaction-trend-scroll-controls"
          gap={4}
          justify="flex-end"
          role="group"
          aria-label={`Scroll chart dates for ${scope}`}
        >
          <Text size="xs" c="dimmed">
            Dates
          </Text>
          {[
            { direction: -1, label: "Earlier dates", disabled: position.start },
            { direction: 1, label: "Later dates", disabled: position.end },
          ].map(({ direction, label, disabled }) => (
            <Button
              key={direction}
              size="compact-xs"
              variant="subtle"
              aria-label={`${label} for ${scope}`}
              aria-controls={scrollId}
              aria-disabled={disabled}
              data-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              onClick={() => {
                if (!disabled) scroll(direction);
              }}
            >
              {label}
            </Button>
          ))}
        </Group>
      ) : null}
      <div className="transaction-trend-viewport">
        <div className="transaction-trend-axis">
          <AmountTrendAxis currency={currency} ticks={chart.ticks} />
        </div>
        <div
          ref={target}
          id={scrollId}
          className="transaction-trend-scroll"
          role="region"
          aria-label={`${scope} ${periodName} chart`}
          aria-describedby={instructionId}
        >
          <VisuallyHidden id={instructionId}>
            Use the Left and Right Arrow keys to inspect periods, or Home and End to move to the
            first and last period. Open the selected period or a type group in the details below.
          </VisuallyHidden>
          <div
            className="transaction-trend-canvas"
            style={{ "--trend-min-width": `${String(points.length * 14 + 56)}px` } as CSSProperties}
          >
            <AmountTrendPlot
              {...{
                points: labeledPoints,
                currency,
                inspectedId,
                onInspect,
                onNavigate,
                onSelect,
                onSelectSegment,
              }}
              series={chart.groups}
              lines={chart.lines}
              zero={chart.zero}
              ticks={chart.ticks}
              showAxis={false}
              keyboardNavigation
            />
          </div>
        </div>
      </div>
    </>
  );
}
