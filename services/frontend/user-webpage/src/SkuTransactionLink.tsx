import { Anchor } from "@mantine/core";
import "./SkuTransactionLink.css";

export function SkuTransactionLink({
  sku,
  onShowTransactions,
  className,
}: {
  sku: string;
  onShowTransactions: (sku: string) => void;
  className?: string;
}) {
  return (
    <Anchor
      component="button"
      type="button"
      fw={600}
      className={["sku-transaction-link", className].filter(Boolean).join(" ")}
      aria-label={`Show transactions for ${sku}`}
      title="View all transactions for this SKU"
      onClick={() => {
        onShowTransactions(sku);
      }}
    >
      {sku}
    </Anchor>
  );
}
