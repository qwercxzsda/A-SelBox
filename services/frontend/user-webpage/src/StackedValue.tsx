import type { ReactNode } from "react";
import "./Cell.css";

export function MutedValue({ children = "—" }: { children?: ReactNode }) {
  return <span className="muted-value">{children}</span>;
}

/** A value with each known detail beneath it, like Quantity under Reported amount. */
export function StackedValue({
  value,
  details,
}: {
  value: ReactNode;
  details: readonly (readonly [label: string, value: string | null])[];
}) {
  return (
    <div className="stacked-cell-value">
      <span>{value ?? <MutedValue />}</span>
      {details.map(([label, detail]) =>
        detail === null ? null : (
          <span key={label} className="stacked-cell-secondary">
            {label}: {detail}
          </span>
        ),
      )}
    </div>
  );
}
