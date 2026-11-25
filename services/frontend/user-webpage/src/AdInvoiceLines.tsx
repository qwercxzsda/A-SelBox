import { useQuery } from "@tanstack/react-query";
import { Text } from "@mantine/core";
import { fetchAdInvoiceLines, type CanonicalRow } from "./api";
import { adProgramLabel, invoiceLineKindLabel } from "./amazon-codes";
import type { Identity } from "./auth-session";
import { formatExactAmount, sumExactDecimals } from "./decimal";
import type { DetailColumn } from "./detail-columns";
import { DetailTable } from "./DetailTable";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";

function lineCell(row: CanonicalRow, column: DetailColumn, currency: string) {
  if (column.kind === "amount") return formatExactAmount(row[column.key] ?? null, currency);
  if (column.key === "line_kind")
    return invoiceLineKindLabel(row.line_kind ?? "", row.adjustment_kind ?? null);
  if (column.key === "ad_program" && row.ad_program) return adProgramLabel(row.ad_program);
  return undefined;
}

function totalCell(total: CanonicalRow, column: DetailColumn, currency: string) {
  return (
    <strong>
      {column.key === "line_number"
        ? "Total"
        : column.kind === "amount"
          ? formatExactAmount(total[column.key] ?? null, currency)
          : ""}
    </strong>
  );
}

function lineColumns(currency: string): DetailColumn[] {
  return [
    { key: "line_number", label: "Line", kind: "number" },
    { key: "line_kind", label: "Kind" },
    { key: "campaign_id", label: "Campaign ID" },
    { key: "campaign_name", label: "Campaign name" },
    { key: "ad_program", label: "Ad program" },
    { key: "cost_amount", label: `Cost (${currency})`, kind: "amount" },
    // Amazon states tax only for the whole invoice; SelBox works out each line's share.
    { key: "tax_amount", label: `Tax, calculated (${currency})`, kind: "amount" },
  ];
}

/** One invoice's lines in Amazon's order, with exact totals of cost and tax. */
export function AdInvoiceLines({
  identity,
  invoice,
}: {
  identity: Identity;
  invoice: CanonicalRow;
}) {
  const versionId = invoice.version_id ?? "";
  const lineCount = Number(invoice.line_count);
  const currency = invoice.currency ?? "";
  const query = useQuery({
    queryKey: ["ad-invoice-lines", identity.session.user.id, versionId, lineCount],
    queryFn: ({ signal }) =>
      fetchAdInvoiceLines(identity.session.access_token, { versionId, lineCount }, signal),
    // A version's lines never change; a newer invoice version is a different row.
    staleTime: Infinity,
  });
  if (query.isError)
    return (
      <ErrorAlert
        title="Could not load invoice lines"
        detail={loadErrorDetail(query.error)}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data)
    return (
      <Text size="sm" c="dimmed" role="status">
        Loading lines…
      </Text>
    );
  const total: CanonicalRow = {
    cost_amount: sumExactDecimals(query.data.map((line) => line.cost_amount)) ?? "0",
    tax_amount: sumExactDecimals(query.data.map((line) => line.tax_amount)) ?? "0",
  };
  return (
    <DetailTable
      label="Invoice lines"
      columns={lineColumns(currency)}
      rows={[...query.data, total]}
      rowKey={(row) => row.id ?? "total"}
      // Fits the record drawer; narrower screens scroll the table sideways.
      minWidth={600}
      renderCell={(row, column) =>
        row === total ? totalCell(total, column, currency) : lineCell(row, column, currency)
      }
    />
  );
}
