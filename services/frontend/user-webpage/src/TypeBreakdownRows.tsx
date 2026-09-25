import { useId } from "react";
import { FinancialAmounts } from "./FinancialAmounts";
import { Accordion, Group, Table, Text, VisuallyHidden } from "@mantine/core";
import type { CurrencyTotal, TransactionTypeTotal } from "./api/types";
import { transactionTypeLabel } from "./categories";
import { formatExactMoney } from "./decimal";
import type { TransactionTypeGroup } from "./type-breakdown-groups";

const AMOUNTS = [
  ["reportedAmount", "Reported amount"],
  ["serviceFee", "Service fee"],
  ["companyAmount", "Company amount"],
] as const;

function UncalculatedNote({ total }: { total: CurrencyTotal }) {
  return total.missingFeeCount > 0 ? (
    <Text size="xs" c="orange.9" mt={2}>
      {total.missingFeeCount.toLocaleString("en-US")} uncalculated
    </Text>
  ) : null;
}

function AmountRow({ total }: { total: TransactionTypeTotal }) {
  const label = transactionTypeLabel(total.type);
  return (
    <Table.Tr aria-label={`${label} amounts`}>
      <Table.Th scope="row">
        <Text size="sm" fw={500} title={total.type}>
          {label}
        </Text>
        <UncalculatedNote total={total} />
      </Table.Th>
      {AMOUNTS.map(([field]) => (
        <Table.Td key={field} ta="right">
          {formatExactMoney(total[field], total.currency)}
        </Table.Td>
      ))}
      <Table.Td ta="right">{total.rowCount.toLocaleString("en-US")}</Table.Td>
    </Table.Tr>
  );
}

function MobileType({ total }: { total: TransactionTypeTotal }) {
  const label = transactionTypeLabel(total.type);
  return (
    <article className="type-breakdown-type" aria-label={`${label} amounts`}>
      <Group justify="space-between" gap="xs" align="start">
        <Text component="h4" m={0} fw={500} size="sm" flex={1} miw={0} title={total.type}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {total.rowCount.toLocaleString("en-US")} {total.rowCount === 1 ? "record" : "records"}
        </Text>
      </Group>
      <FinancialAmounts total={total} />
      <UncalculatedNote total={total} />
    </article>
  );
}

function OriginalTypes({ types }: { types: TransactionTypeTotal[] }) {
  return (
    <>
      <Table
        className="type-breakdown-table"
        aria-label="Transaction type amounts"
        fz="sm"
        verticalSpacing="sm"
      >
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
            {AMOUNTS.map(([field, label]) => (
              <Table.Th key={field} ta="right">
                {label}
              </Table.Th>
            ))}
            <Table.Th ta="right">Records</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {types.map((total) => (
            <AmountRow key={total.type} total={total} />
          ))}
        </Table.Tbody>
      </Table>
      <div className="type-breakdown-mobile">
        {types.map((total) => (
          <MobileType key={total.type} total={total} />
        ))}
      </div>
    </>
  );
}

export function TypeBreakdownRows({ groups }: { groups: TransactionTypeGroup[] }) {
  const amountIdPrefix = useId();

  return (
    <Accordion
      multiple
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
              <span
                id={`${amountIdPrefix}-${group.id}-amount`}
                className="type-breakdown-group-amount"
              >
                <VisuallyHidden>
                  {group.totals.missingFeeCount > 0 ? "Known company amount" : "Company amount"}
                  :{" "}
                </VisuallyHidden>
                {formatExactMoney(group.totals.companyAmount, group.totals.currency)}
                {group.totals.missingFeeCount > 0 ? (
                  <Text
                    component="span"
                    display="block"
                    size="xs"
                    c="orange.9"
                    mt={2}
                    aria-hidden="true"
                  >
                    Known company amount
                  </Text>
                ) : null}
              </span>
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
            </section>
            <OriginalTypes types={group.types} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
