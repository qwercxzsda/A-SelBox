import { reviewPeriodKey } from "./financial-review-scope-key";
import { useRef } from "react";
import "./AppliedFilterChips.css";
import { Button, Group, NativeSelect } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewRecords } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { sourceCodeLabel } from "./categories";
import {
  reviewFamilyStateKey,
  type FinancialReviewSourceProps,
} from "./financial-review-source-state";
import { FinancialSourceRecord } from "./FinancialSourceRecord";
import {
  decodeFinancialSourceSelection,
  type FinancialSourceSelection,
} from "./api/financial-source";
import { useWorkspacePreference } from "./use-workspace-preference";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";

export function FinancialReviewRecords({
  identity,
  category,
  month,
  currency,
  marketplace,
  families,
  state,
  change,
}: FinancialReviewSourceProps) {
  const [selection, setSelection] = useWorkspacePreference<FinancialSourceSelection | null>(
    `financial-review:source-detail:${category}:${reviewPeriodKey(month, marketplace, currency)}${reviewFamilyStateKey(families)}`,
    () => null,
    decodeFinancialSourceSelection,
  );
  const controls = useRef<HTMLDivElement>(null);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const focus = useDrawerFocusReturn({ opened: selection !== null, fallbackRef: controls });
  const query = useQuery({
    queryKey: [
      "financial-review",
      "records",
      identity.session.user.id,
      category,
      month,
      currency,
      marketplace,
      families,
      state.source,
      state.type,
      state.recordPage,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewRecords(
        identity.session.access_token,
        category,
        month,
        currency,
        marketplace,
        state.recordPage,
        { source: state.source || undefined, type: state.type || undefined },
        signal,
        families,
      ),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <>
      <Group ref={controls} tabIndex={-1} mb="sm" gap="sm" align="end">
        <NativeSelect
          ref={sourceInput}
          label="Record source"
          value={state.source}
          data={[
            { value: "", label: "All sources" },
            { value: "FINANCES", label: "Finances" },
            { value: "DATA_KIOSK", label: "Data Kiosk" },
          ]}
          onChange={(event) => {
            const source = event.currentTarget.value;
            change({
              source: source === "FINANCES" || source === "DATA_KIOSK" ? source : "",
              type: "",
              recordPage: 0,
            });
          }}
        />
        {state.type ? (
          <Button
            className="applied-table-filter"
            size="xs"
            variant="light"
            aria-label="Clear selected type"
            title={sourceCodeLabel(state.type)}
            rightSection={<span aria-hidden="true">×</span>}
            onClick={(event) => {
              if (event.detail === 0) sourceInput.current?.focus();
              change({ type: "", recordPage: 0 });
            }}
          >
            <span className="applied-table-filter-text">{sourceCodeLabel(state.type)}</span>
          </Button>
        ) : null}
      </Group>
      <DetailData
        query={query}
        label="source records"
        rowCount={rows.length}
        emptyMessage="No source records match this selection."
        pagination={{
          pageIndex: state.recordPage,
          totalCount: query.data?.totalCount ?? null,
          onPageChange: (recordPage) => {
            change({ recordPage });
          },
        }}
      >
        {rows.length ? (
          <DetailTable
            label="Source records"
            rows={rows}
            rowKey={(row) => `${row.source ?? ""}:${row.source_row_id ?? ""}`}
            selectedRowKey={selection ? `${selection.source}:${selection.rowId}` : null}
            onSelectRow={(row) => {
              focus.rememberOpener();
              setSelection({
                source: row.source === "FINANCES" ? "FINANCES" : "DATA_KIOSK",
                rowId: row.source_row_id ?? "",
                versionId: row.source_version_id ?? "",
              });
            }}
            minWidth={820}
            columns={[
              { key: "activity_date", label: "Date", kind: "date" },
              { key: "source", label: "Source", kind: "source", nowrap: true },
              { key: "sku", label: "SKU", empty: "No SKU", nowrap: true },
              { key: "marketplace_name", label: "Marketplace", empty: "Not specified" },
              { key: "component_type", label: "Type", kind: "type" },
              { key: "amount", label: `Amount (${currency})`, kind: "amount" },
              { key: "seller_namespace", label: "Source namespace" },
            ]}
          />
        ) : null}
      </DetailData>
      <FinancialSourceRecord
        identity={identity}
        selection={selection}
        stacked
        onClose={() => {
          setSelection(null);
        }}
        onExitTransitionEnd={focus.restoreFocus}
      />
    </>
  );
}
