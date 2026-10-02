import { transactionTypeLabel } from "./categories";

export function TransactionTypeValue({ value }: { value: string }) {
  const label = transactionTypeLabel(value);
  const separator = label.lastIndexOf(" · ");
  const hierarchical = separator >= 0;
  return (
    <span
      className={
        value.startsWith("MISSING_") ? "transaction-type missing-value" : "transaction-type"
      }
      data-hierarchical={hierarchical || undefined}
      title={`${label}\n${value}`}
    >
      {hierarchical ? (
        <>
          <span className="transaction-type-prefix">{label.slice(0, separator)}</span>
          <span className="transaction-type-separator">{" · "}</span>
        </>
      ) : null}
      <span className="transaction-type-leaf">
        {hierarchical ? label.slice(separator + 3) : label}
      </span>
    </span>
  );
}
