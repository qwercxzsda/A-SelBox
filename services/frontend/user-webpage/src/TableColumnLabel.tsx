import "./TableColumnLabel.css";

/** Keep a heading's parenthesized explanation visually secondary without hiding it. */
export function TableColumnLabel({ label }: { label: string }) {
  const parts = /^(.+?) (\([^()]+\))$/.exec(label);
  if (!parts) return label;
  return (
    <>
      {parts[1]} <span className="table-column-parenthetical">{parts[2]}</span>
    </>
  );
}
