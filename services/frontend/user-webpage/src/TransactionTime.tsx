import "./TransactionTime.css";
import type { CanonicalRow } from "./api";
import { formatRecordDate } from "./date-display";

export function TransactionTime({ row }: { row: CanonicalRow }) {
  const value = row.activity_at;
  if (!value) return <span className="muted-value">—</span>;
  const [date, time] = formatRecordDate(value, { includeTimeZone: false }).split(" ");
  const assumption =
    row.source === "DATA_KIOSK" || row.day_id
      ? `Assumed end of ${row.activity_date ?? "the source day"} in ${row.marketplace_name ?? "the marketplace"}'s local time zone`
      : undefined;
  return (
    <time className="transaction-time" dateTime={value} title={value} aria-description={assumption}>
      <span className="transaction-date">{date}</span>{" "}
      <small className="transaction-clock" title={assumption}>
        {time}
      </small>
    </time>
  );
}
