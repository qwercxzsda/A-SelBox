import { useRef, useState } from "react";
import { Button, Group, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialSourceTransactions } from "./api";
import {
  decodeFinancialSourceSelection,
  type FinancialSourceSelection,
} from "./api/financial-source";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { FinancialSourceRecord } from "./FinancialSourceRecord";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { useWorkspacePreference } from "./use-workspace-preference";
import { LookupPagination } from "./LookupPagination";

export function FinancialSourceLookup({ identity }: { identity: Identity }) {
  const [transactionId, setTransactionId] = useWorkspacePreference(
    "finances:transaction-lookup",
    () => "",
    (value) => (typeof value === "string" && value.length <= 512 ? value : ""),
  );
  const [input, setInput] = useState(transactionId);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useWorkspacePreference<FinancialSourceSelection | null>(
    "finances:transaction-lookup:selected",
    () => null,
    decodeFinancialSourceSelection,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const focus = useDrawerFocusReturn({ opened: selection !== null, fallbackRef: inputRef });
  const query = useQuery({
    queryKey: ["financial-source-lookup", identity.session.user.id, transactionId, pageIndex],
    queryFn: ({ signal }) =>
      fetchFinancialSourceTransactions(
        identity.session.access_token,
        transactionId,
        pageIndex,
        signal,
      ),
    enabled: transactionId.length > 0 && identity.account.access_role === "administrator",
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  function changePage(nextPage: number) {
    setPageIndex(nextPage);
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  const pagination = {
    label: "matches",
    pageIndex,
    hasNext: query.data?.hasNext ?? false,
    disabled: query.isFetching,
    onPageChange: changePage,
  };
  if (identity.account.access_role !== "administrator") return null;
  return (
    <DetailSection
      stateKey="finances:transaction-lookup"
      title="Find Amazon transaction"
      collapsible
      description="Search an exact Amazon transaction ID across all retained captures. This lookup is independent of the table filters."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTransactionId(input.trim());
          setPageIndex(0);
          setSelection(null);
        }}
      >
        <Group align="end" mb="sm">
          <TextInput
            ref={inputRef}
            label="Amazon transaction ID"
            value={input}
            maxLength={512}
            style={{ flex: 1, minWidth: 220 }}
            onChange={(event) => {
              setInput(event.currentTarget.value);
            }}
          />
          <Button type="submit" disabled={!input.trim()}>
            Find transaction
          </Button>
        </Group>
      </form>
      {transactionId ? (
        <section
          ref={resultsRef}
          tabIndex={-1}
          className="detail-data"
          aria-label="Amazon transaction results"
        >
          <Text size="xs" c="dimmed" mb="sm" style={{ overflowWrap: "anywhere" }}>
            Showing {transactionId}. Each row is one amount component. Current and retained captures
            are separate observations; do not add them together.
          </Text>
          <DetailData
            query={query}
            label="Amazon transaction"
            rowCount={rows.length}
            emptyMessage="No retained source record has this exact Amazon transaction ID."
          >
            {query.data || pageIndex > 0 ? <LookupPagination {...pagination} mb="sm" /> : null}
            {rows.length ? (
              <DetailTable
                label="Amazon transaction matches"
                minWidth={850}
                rows={rows}
                rowKey={(row) => row.id ?? ""}
                columns={[
                  { key: "posted_date", label: "Date", kind: "date" },
                  { key: "capture_status", label: "Capture" },
                  { key: "marketplace_name", label: "Marketplace" },
                  { key: "component_type", label: "Type", kind: "type" },
                  { key: "amount", label: "Amount", kind: "amount" },
                  { key: "currency", label: "Currency" },
                  { key: "details", label: "Details" },
                ]}
                renderCell={(row, column) =>
                  column.key === "details" ? (
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      onClick={(event) => {
                        event.currentTarget.focus();
                        focus.rememberOpener();
                        setSelection({
                          source: "FINANCES",
                          rowId: row.id ?? "",
                          versionId: row.version_id ?? "",
                        });
                      }}
                    >
                      View source record
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {rows.length > 10 ? <LookupPagination {...pagination} bottom /> : null}
          </DetailData>
        </section>
      ) : null}
      <FinancialSourceRecord
        identity={identity}
        selection={selection}
        onClose={() => {
          setSelection(null);
        }}
        onExitTransitionEnd={focus.restoreFocus}
      />
    </DetailSection>
  );
}
