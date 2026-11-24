import "./TransactionTime.css";
import type { CanonicalRow } from "./api";
import { formatRecordDate } from "./date-display";

export function TransactionTime({ row }: { row: CanonicalRow }) {
  const value = row.activity_at;
  if (!value) return <span className="muted-value">—</span>;
  const [date, time] = formatRecordDate(value, { includeTimeZone: false }).split(" ");
  return (
    <time className="transaction-time" dateTime={value} title={value}>
      <span className="transaction-date">{date}</span>{" "}
      <small className="transaction-clock">{time}</small>
    </time>
  );
}
