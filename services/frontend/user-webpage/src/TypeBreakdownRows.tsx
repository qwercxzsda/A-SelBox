import { useId } from "react";
import { FinancialAmounts } from "./FinancialAmounts";
import { Accordion, Button, Group, Table, Text } from "@mantine/core";
import type { CurrencyTotal, TransactionTypeTotal } from "./api/types";
import { transactionTypeLabel } from "./categories";
import { formatExactMoney } from "./decimal";
import type { TransactionTypeGroup } from "./type-breakdown-groups";

import { FINANCIAL_AMOUNTS, financialAmountLabel } from "./financial-amounts";
import type { RecordSelection } from "./AmountBreakdown";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailStrings } from "./detail-view-state";
import { TypeBreakdownAmounts } from "./TypeBreakdownAmounts";

type SelectRecords = (selection: RecordSelection) => void;

function UncalculatedNote({ total }: { total: CurrencyTotal }) {
  return total.missingFeeCount > 0 ? (
    <Text size="xs" c="orange.9" mt={2}>
      {total.missingFeeCount.toLocaleString("en-US")} uncalculated
    </Text>
  ) : null;
}

function AmountRow({
  total,
  onSelectRecords,
}: {
  total: TransactionTypeTotal;
  onSelectRecords: SelectRecords;
}) {
  const label = transactionTypeLabel(total.type);
  return (
    <Table.Tr aria-label={`${label} amounts`}>
      <Table.Th scope="row">
        <Text inherit fw={500} title={total.type}>
          {label}
        </Text>
        <UncalculatedNote total={total} />
      </Table.Th>
      {FINANCIAL_AMOUNTS.map(([field]) => (
        <Table.Td key={field} ta="right">
          {formatExactMoney(total[field], total.currency)}
        </Table.Td>
      ))}
      <Table.Td ta="right">
        <Button
          size="compact-xs"
          variant="subtle"
          aria-label={`View ${label} records`}
          onClick={() => {
            onSelectRecords({ label, types: [total.type] });
          }}
        >
          {total.rowCount.toLocaleString("en-US")}
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}

function MobileType({
  total,
  onSelectRecords,
}: {
  total: TransactionTypeTotal;
  onSelectRecords: SelectRecords;
}) {
  const label = transactionTypeLabel(total.type);
  return (
    <article className="type-breakdown-type" aria-label={`${label} amounts`}>
      <Group justify="space-between" gap="xs" align="start">
        <Text component="h4" m={0} fw={500} size="sm" flex={1} miw={0} title={total.type}>
          {label}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          aria-label={`View ${label} records`}
          onClick={() => {
            onSelectRecords({ label, types: [total.type] });
          }}
        >
          {total.rowCount.toLocaleString("en-US")} {total.rowCount === 1 ? "record" : "records"}
        </Button>
      </Group>
      <FinancialAmounts total={total} />
      <UncalculatedNote total={total} />
    </article>
  );
}

function OriginalTypes({
  types,
  onSelectRecords,
}: {
  types: TransactionTypeTotal[];
  onSelectRecords: SelectRecords;
}) {
  return (
    <>
      <Table className="detail-table type-breakdown-table" aria-label="Transaction type amounts">
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Type</Table.Th>
            {FINANCIAL_AMOUNTS.map(([field, label]) => (
              <Table.Th key={field} ta="right">
                {label}
              </Table.Th>
            ))}
            <Table.Th ta="right">Records</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {types.map((total) => (
            <AmountRow key={total.type} total={total} onSelectRecords={onSelectRecords} />
          ))}
        </Table.Tbody>
      </Table>
      <div className="type-breakdown-mobile">
        {types.map((total) => (
          <MobileType key={total.type} total={total} onSelectRecords={onSelectRecords} />
        ))}
      </div>
    </>
  );
}

export function TypeBreakdownRows({
  groups,
  onSelectRecords,
  stateKey,
}: {
  groups: TransactionTypeGroup[];
  onSelectRecords: SelectRecords;
  stateKey: string;
}) {
  const amountIdPrefix = useId();
  const hasUncalculatedAmounts = groups.some((group) => group.totals.missingFeeCount > 0);
  const [expanded, setExpanded] = useWorkspacePreference<string[]>(
    `${stateKey}:type-groups`,
    () => [],
    decodeDetailStrings,
  );

  return (
    <>
      <div className="type-breakdown-column-headings" aria-hidden="true">
        <span className="type-breakdown-group-name">Type</span>
        <span className="type-breakdown-group-amounts">
          {FINANCIAL_AMOUNTS.map((field) => (
            <span key={field[0]}>{financialAmountLabel(field, hasUncalculatedAmounts)}</span>
          ))}
        </span>
      </div>
      <Accordion
        transitionDuration={0}
        multiple
        value={expanded}
        onChange={setExpanded}
        keepMounted={false}
        className="type-breakdown-groups"
        classNames={{
          label: "type-breakdown-control-label",
          chevron: "type-breakdown-chevron",
        }}
      >
        {groups.map((group) => (
          <Accordion.Item key={group.id} value={group.id}>
            <Accordion.Control
              aria-label={`${group.label} details`}
              aria-describedby={`${amountIdPrefix}-${group.id}-amount`}
            >
              <span className="type-breakdown-control-text">
                <span className="type-breakdown-group-name">{group.label}</span>
                <TypeBreakdownAmounts
                  id={`${amountIdPrefix}-${group.id}-amount`}
                  total={group.totals}
                />
              </span>
            </Accordion.Control>
            <Accordion.Panel>
              <section
                className="type-breakdown-group-summary"
                aria-label={`${group.label} subtotal`}
              >
                <Text size="xs" c="dimmed">
                  {group.totals.rowCount.toLocaleString("en-US")}{" "}
                  {group.totals.rowCount === 1 ? "record" : "records"} across{" "}
                  {group.types.length.toLocaleString("en-US")}{" "}
                  {group.types.length === 1 ? "type" : "types"}
                </Text>
                <FinancialAmounts total={group.totals} />
                <UncalculatedNote total={group.totals} />
                <Button
                  mt="sm"
                  size="xs"
                  variant="light"
                  onClick={() => {
                    onSelectRecords({
                      label: group.label,
                      types: group.types.map((type) => type.type),
                    });
                  }}
                >
                  View {group.label} records
                </Button>
              </section>
              <OriginalTypes types={group.types} onSelectRecords={onSelectRecords} />
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </>
  );
}
