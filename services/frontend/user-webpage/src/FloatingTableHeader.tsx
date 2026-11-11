import { useEffect, useState, type RefObject } from "react";
import { Portal } from "@mantine/core";

interface HeaderSnapshot {
  left: number;
  width: number;
  height: number;
  cells: { label: string; left: number; width: number; align: string }[];
}

/** Visual column context while the document scrolls; the real table retains its semantics. */
export function FloatingTableHeader({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const [snapshot, setSnapshot] = useState<HeaderSnapshot | null>(null);
  useEffect(() => {
    const container = target.current;
    const table = container?.querySelector("table");
    const head = table?.querySelector("thead");
    if (!container || !table || !head) return;
    let frame = 0;
    const measure = () => {
      const bounds = container.getBoundingClientRect();
      const header = head.getBoundingClientRect();
      const next: HeaderSnapshot | null =
        header.top < 0 && bounds.bottom > header.height
          ? {
              left: bounds.left,
              width: container.clientWidth,
              height: header.height,
              cells: [...head.querySelectorAll("th")].map((cell) => {
                const rect = cell.getBoundingClientRect();
                return {
                  label: (cell.getAttribute("data-floating-header-label") ?? cell.textContent)
                    .replace(/\s+/g, " ")
                    .trim(),
                  left: rect.left - bounds.left,
                  width: rect.width,
                  align: getComputedStyle(cell).textAlign,
                };
              }),
            }
          : null;
      setSnapshot((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(table);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    container.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      container.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [target]);
  return snapshot ? (
    <Portal>
      <div
        aria-hidden="true"
        className="floating-table-header"
        style={{ left: snapshot.left, width: snapshot.width, height: snapshot.height }}
      >
        {snapshot.cells.map((cell, index) => (
          <span
            key={index}
            style={{
              left: cell.left,
              width: cell.width,
              justifyContent: cell.align === "right" ? "flex-end" : "flex-start",
            }}
          >
            {cell.label}
          </span>
        ))}
      </div>
    </Portal>
  ) : null;
}
