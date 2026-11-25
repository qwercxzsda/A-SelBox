import { formatRecordDate } from "./date-display";
import "./RecordTimestamp.css";

/** A timestamp cell in UTC; its column heading carries "(UTC)". */
export function RecordTimestamp({ value }: { value: string }) {
  return (
    <time className="record-timestamp" dateTime={value} title={value}>
      {formatRecordDate(value, { includeTimeZone: false })}
    </time>
  );
}
