import type { CanonicalRow, DatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { humanizeCode } from "./categories";
import { DATASET_PRESENTATION, TABLE_COLUMNS, rowId, type ColumnDefinition } from "./view-model";

export function RowDetail({
  companies,
  dataset,
  row,
  skuNames,
}: {
  companies: Map<string, string>;
  dataset: DatasetKey;
  row: CanonicalRow;
  skuNames: Map<string, string>;
}) {
  const columns = TABLE_COLUMNS[dataset];
  const shown = new Set(columns.map((column) => column.key));
  const remaining = Object.keys(row).filter((key) => !shown.has(key));
  return (
    <section className="detail-card" aria-label="Selected row details">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Selected row</p>
          <h2>{row.sku ?? DATASET_PRESENTATION[dataset].label}</h2>
          <p>Exact values for this record.</p>
        </div>
      </div>
      <div className="detail-section detail-grid">
        {columns.map((column) => (
          <div className="detail-field" key={column.key}>
            <span className="field-label">{column.label}</span>
            <span className="field-value">
              <TableCellValue column={column} companies={companies} row={row} skuNames={skuNames} />
            </span>
          </div>
        ))}
      </div>
      <details className="audit-details" key={rowId(row)}>
        <summary>Source and version details</summary>
        <div className="audit-grid">
          {remaining.map((key) => {
            const column: ColumnDefinition = { key, kind: "text", label: humanizeCode(key) };
            return (
              <div className="audit-value" key={key}>
                <span className="field-label">{column.label}</span>
                <code>
                  <TableCellValue column={column} companies={companies} row={row} />
                </code>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
