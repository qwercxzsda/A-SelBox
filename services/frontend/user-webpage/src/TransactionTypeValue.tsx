import { transactionTypeLabel } from "./categories";

export function TransactionTypeValue({ value }: { value: string }) {
  const label = transactionTypeLabel(value);
  return (
    <span
      className={
        value.startsWith("MISSING_") ? "transaction-type missing-value" : "transaction-type"
      }
      title={`${label}\n${value}`}
    >
      {label}
    </span>
  );
}
