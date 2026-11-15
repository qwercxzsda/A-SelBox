import { Text, UnstyledButton } from "@mantine/core";
import { useId, useRef } from "react";
import { FINANCIAL_AMOUNTS } from "./financial-amounts";
import { TransactionTrendNavigation } from "./TransactionTrendNavigation";
import { TableScrollControls } from "./TableScrollControls";
import { TRANSACTION_TYPE_GROUPS, type TypeGroupId } from "./transaction-type-families";
import {
  compactTransactionTrendDateLabel,
  transactionTrendDateLabel,
  type TransactionTrendPoint,
} from "./transaction-trend-chart";
import { formatAmount } from "./decimal";
import {
  trendAmountText,
  trendAmountTitle,
  type TrendAmountField,
} from "./transaction-trend-labels";
import type { DateRange } from "./summary-periods";

function AmountValue({
  value,
  field,
  missingFeeCount,
}: {
  value: string | null;
  field: TrendAmountField;
  missingFeeCount: number;
}) {
  return (
    <>
      {value === null ? "Unknown" : formatAmount(value)}
      {value !== null && field !== "reportedAmount" && missingFeeCount > 0 ? (
        <span className="transaction-trend-known-amount">Known subtotal</span>
      ) : null}
    </>
  );
}

export function TransactionTrendInspection({
  points,
  inspected,
  currency,
  scope,
  periodName,
  colors,
  onNavigate,
  onSelect,
}: {
  points: readonly TransactionTrendPoint[];
  inspected: TransactionTrendPoint;
  currency: string;
  scope: string;
  periodName: "day" | "week";
  colors: ReadonlyMap<string, string>;
  onNavigate: (id: string) => void;
  onSelect: (range: DateRange, groupId?: TypeGroupId) => void;
}) {
  const tableTarget = useRef<HTMLDivElement>(null);
  const tableId = useId();
  const fullDate = transactionTrendDateLabel(inspected);
  const range = { from: inspected.from, to: inspected.to };
  const groups = inspected.groups.filter((group) => group.rowCount > 0);
  const groupLabels = new Map(TRANSACTION_TYPE_GROUPS.map((group) => [group.id, group.label]));
  return (
    <section
      className="transaction-trend-inspection"
      aria-label={`Selected ${periodName} amounts for ${scope}`}
    >
      <TransactionTrendNavigation
        points={points}
        inspected={inspected}
        scope={scope}
        periodName={periodName}
        onNavigate={onNavigate}
        onOpen={() => {
          onSelect(range);
        }}
      />
      <div className="transaction-trend-selection-heading">
        <Text size="sm" fw={500} title={fullDate}>
          {compactTransactionTrendDateLabel(inspected)}{" "}
          <span className="transaction-trend-timezone">UTC · {currency}</span>
        </Text>
        <Text size="xs" c="dimmed">
          {inspected.rowCount.toLocaleString("en-US")}{" "}
          {inspected.rowCount === 1 ? "transaction" : "transactions"}
        </Text>
      </div>
      <dl className="transaction-trend-selected-amounts">
        {FINANCIAL_AMOUNTS.map(([field, label]) => (
          <div key={field} data-amount-field={field}>
            <dt>{label}</dt>
            <dd
              title={trendAmountTitle(inspected[field], currency, field, inspected.missingFeeCount)}
            >
              <AmountValue
                value={inspected[field]}
                field={field}
                missingFeeCount={inspected.missingFeeCount}
              />
            </dd>
          </div>
        ))}
      </dl>
      {groups.length ? (
        <>
          <div className="transaction-trend-table-heading">
            <Text size="sm" fw={600}>
              Amounts by type
            </Text>
            <TableScrollControls target={tableTarget} targetId={tableId} />
          </div>
          <div
            ref={tableTarget}
            id={tableId}
            className="transaction-trend-values-scroll"
            role="region"
            aria-label={`Type group amount columns for ${scope}`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Amount columns can be scrolled with the keyboard on narrow screens.
            tabIndex={0}
          >
            <table
              className="transaction-trend-groups"
              aria-label={`Amounts by type for selected ${periodName}`}
            >
              <colgroup>
                <col style={{ width: "34%" }} />
                {FINANCIAL_AMOUNTS.map(([field]) => (
                  <col key={field} style={{ width: "22%" }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Type group</th>
                  {FINANCIAL_AMOUNTS.map(([field, label]) => (
                    <th key={field} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id} data-group-id={group.id}>
                    <th scope="row">
                      <span
                        className="transaction-trend-group-swatch"
                        style={{ backgroundColor: colors.get(group.id) }}
                        aria-hidden="true"
                      />
                      {groupLabels.get(group.id)}
                    </th>
                    {FINANCIAL_AMOUNTS.map(([field, label]) => (
                      <td
                        key={field}
                        data-amount-field={field}
                        title={trendAmountTitle(
                          group[field],
                          currency,
                          field,
                          group.missingFeeCount,
                        )}
                      >
                        {field === "companyAmount" ? (
                          <UnstyledButton
                            className="ui-text-action transaction-trend-group-action"
                            aria-haspopup="dialog"
                            aria-label={`${groupLabels.get(group.id) ?? group.id}: Open transaction totals for ${fullDate} in ${scope}, ${label}: ${trendAmountText(group[field], currency, field, group.missingFeeCount)}`}
                            onClick={() => {
                              onSelect(range, group.id);
                            }}
                          >
                            <AmountValue
                              value={group[field]}
                              field={field}
                              missingFeeCount={group.missingFeeCount}
                            />
                          </UnstyledButton>
                        ) : (
                          <AmountValue
                            value={group[field]}
                            field={field}
                            missingFeeCount={group.missingFeeCount}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Text size="sm" c="dimmed" className="transaction-trend-empty-period">
          No transactions for this {periodName}.
        </Text>
      )}
    </section>
  );
}
