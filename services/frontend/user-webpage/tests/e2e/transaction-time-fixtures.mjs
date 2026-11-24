export function timestampedTransaction(row) {
  return { ...row, activity_at: row.activity_at ?? `${row.activity_date}T12:00:00.000000Z` };
}
export function timestampedSource(row) {
  return {
    ...row,
    activity_at:
      row.activity_at ?? new Date(row.posted_at).toISOString().replace(".000Z", ".000000Z"),
  };
}
