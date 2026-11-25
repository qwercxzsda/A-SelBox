import { useRef, useState } from "react";
import { Button, Drawer, Group } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialSourceTransactions } from "./api";
import {
  decodeFinancialSourceSelection,
  type FinancialSourceSelection,
} from "./api/financial-source";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { DetailDrawer } from "./DetailDrawer";
import { DetailTable } from "./DetailTable";
import { decodeDetailOpen, decodeDetailPage } from "./detail-view-state";
import { FinancialSourceRecord } from "./FinancialSourceRecord";
import { HelpPopover } from "./HelpPopover";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { useWorkspacePreference } from "./use-workspace-preference";
import { LookupPagination } from "./LookupPagination";
import { revealSection } from "./reveal-section";
import { SearchInput } from "./SearchInput";

export function FinancialSourceLookup({ identity }: { identity: Identity }) {
  const [opened, setOpened] = useWorkspacePreference(
    "finances:transaction-lookup:expanded",
    () => false,
    decodeDetailOpen,
  );
  const [transactionId, setTransactionId] = useWorkspacePreference(
    "finances:transaction-lookup",
    () => "",
    (value) => (typeof value === "string" && value.length <= 512 ? value : ""),
  );
  const [input, setInput] = useState(transactionId);
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    "finances:transaction-lookup-page",
    () => 0,
    decodeDetailPage,
  );
  const [selection, setSelection] = useWorkspacePreference<FinancialSourceSelection | null>(
    "finances:transaction-lookup:selected",
    () => null,
    decodeFinancialSourceSelection,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const lookupFocus = useDrawerFocusReturn({ opened, fallbackRef: triggerRef });
  const recordFocus = useDrawerFocusReturn({ opened: selection !== null, fallbackRef: inputRef });
  const query = useQuery({
    queryKey: ["financial-source-lookup", identity.session.user.id, transactionId, pageIndex],
    queryFn: ({ signal }) =>
      fetchFinancialSourceTransactions(
        identity.session.access_token,
        transactionId,
        pageIndex,
        signal,
      ),
    enabled: opened && transactionId.length > 0 && identity.account.access_role === "administrator",
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  /** Paging keeps focus on the results; only the pager below them scrolls to their start. */
  function changePage(nextPage: number, fromBottom: boolean) {
    if (fromBottom) revealSection(resultsRef.current);
    else resultsRef.current?.focus({ preventScroll: true });
    setPageIndex(nextPage);
  }
  const pagination = {
    label: "matches",
    pageIndex,
    hasNext: query.data?.hasNext ?? false,
    disabled: query.isFetching,
  };
  if (identity.account.access_role !== "administrator") return null;
  return (
    <>
      <Button
        ref={triggerRef}
        variant="subtle"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus();
          lookupFocus.rememberOpener();
          setOpened(true);
        }}
      >
        Find by transaction ID…
      </Button>
      <Drawer.Stack>
        <DetailDrawer
          stackId="financial-source-lookup"
          opened={opened}
          onClose={() => {
            setOpened(false);
          }}
          onExitTransitionEnd={lookupFocus.restoreFocus}
          width="wide"
          title="Find transaction"
          context={transactionId ? `${transactionId} · Finances` : "Finances"}
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
              <SearchInput
                inputRef={inputRef}
                data-autofocus
                aria-label="Search Amazon transaction ID"
                placeholder="Exact Amazon transaction ID"
                value={input}
                maxLength={512}
                style={{ flex: 1, minWidth: 220 }}
                onChange={setInput}
              />
              <Group gap={6} wrap="nowrap">
                <Button type="submit" disabled={!input.trim()}>
                  Find transaction
                </Button>
                <HelpPopover label="Transaction lookup help">
                  Each row is one amount. Current and Retained are separate captures; do not add
                  them.
                </HelpPopover>
              </Group>
            </Group>
          </form>
          {transactionId ? (
            <section
              ref={resultsRef}
              tabIndex={-1}
              className="detail-data"
              aria-label="Amazon transaction results"
            >
              <DetailData
                query={query}
                label="Amazon transaction"
                rowCount={rows.length}
                emptyMessage={
                  pageIndex > 0 ? "No matches on this page" : "No transaction with this ID"
                }
              >
                {query.data || pageIndex > 0 ? (
                  <LookupPagination
                    {...pagination}
                    onPageChange={(nextPage) => {
                      changePage(nextPage, false);
                    }}
                    mb="sm"
                  />
                ) : null}
                {rows.length ? (
                  <DetailTable
                    label="Amazon transaction matches"
                    minWidth={720}
                    rows={rows}
                    rowKey={(row) => row.id ?? ""}
                    selectedRowKey={selection?.rowId ?? null}
                    onSelectRow={(row) => {
                      recordFocus.rememberOpener();
                      setSelection({
                        source: "FINANCES",
                        rowId: row.id ?? "",
                        versionId: row.version_id ?? "",
                      });
                    }}
                    columns={[
                      { key: "posted_date", label: "Date", kind: "date" },
                      { key: "is_current", label: "Capture" },
                      { key: "marketplace_name", label: "Marketplace" },
                      { key: "component_type", label: "Type", kind: "type" },
                      { key: "amount", label: "Amount", kind: "amount" },
                      { key: "currency", label: "Currency" },
                    ]}
                    renderCell={(row, column) => {
                      if (column.key === "is_current")
                        return row.is_current === "true" ? "Current" : "Retained";
                      return undefined;
                    }}
                  />
                ) : null}
                {rows.length > 10 ? (
                  <LookupPagination
                    {...pagination}
                    onPageChange={(nextPage) => {
                      changePage(nextPage, true);
                    }}
                    bottom
                  />
                ) : null}
              </DetailData>
            </section>
          ) : null}
        </DetailDrawer>
        <FinancialSourceRecord
          identity={identity}
          selection={opened ? selection : null}
          stacked
          onClose={() => {
            setSelection(null);
          }}
          onExitTransitionEnd={recordFocus.restoreFocus}
        />
      </Drawer.Stack>
    </>
  );
}
