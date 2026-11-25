import type { ReactNode } from "react";
import "./DetailFields.css";

export interface DetailField {
  key: string;
  label: string;
  value: ReactNode;
}

/** The field/value grid for one record's facts inside a drawer. */
export function DetailFields({ fields }: { fields: readonly DetailField[] }) {
  return (
    <div className="detail-grid">
      {fields.map((field) => (
        <div className="detail-field" key={field.key}>
          <span className="field-label">{field.label}</span>
          <span className="field-value">{field.value}</span>
        </div>
      ))}
    </div>
  );
}
