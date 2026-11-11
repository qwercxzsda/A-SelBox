import { sourceCodeLabel } from "./categories";
import { transactionTypeGroupLabel } from "./transaction-type-groups";
import "./TransactionTypeValue.css";

export function TransactionTypeValue({ value }: { value: string }) {
  const label = sourceCodeLabel(value);
  const group = transactionTypeGroupLabel(value);
  return (
    <span
      className={
        value.startsWith("MISSING_") ? "transaction-type missing-value" : "transaction-type"
      }
      title={`${label}\n${group}\n${value}`}
    >
      <span className="transaction-type-label">{label}</span>
      <small className="transaction-type-group">{group}</small>
    </span>
  );
}
