import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchReferenceAssignments } from "./api";
import { assignmentKey, type Assignment } from "./api/assignment-types";
import type { Identity } from "./auth-session";
import { AssignmentDrawer } from "./AssignmentDrawer";
import { AssignmentList } from "./AssignmentList";
import {
  decodeAssignmentList,
  memberAssignmentList,
  newEditorDraft,
  nextUnassigned,
  type AssignmentListState,
} from "./assignments-view";
import { ErrorAlert } from "./ErrorAlert";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { useWorkspacePreference } from "./use-workspace-preference";
import { loadErrorDetail } from "./load-error";
import { companyLabel } from "./view-model";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { NeedsSetupAlert } from "./NeedsSetupAlert";
import "./Assignments.css";

const NO_ASSIGNMENTS: Assignment[] = [];

function AssignmentsHelp({ administrator }: { administrator: boolean }) {
  return (
    <>
      <p>
        An assignment names the company that bears a campaign&apos;s, promotion&apos;s or
        shipment&apos;s charges. Campaign and promotion marketplaces come from Amazon&apos;s own
        records; shipment marketplaces come from the Finances charges that name the shipment.
      </p>
      <p>
        {administrator
          ? "Open an ID to compare its products with their SKU owners, then assign a company. SKU ownership and fee rates are managed in Current fees."
          : "Your company's assignments are read-only. Contact an administrator to change them."}
      </p>
    </>
  );
}

function findRow(key: string) {
  return [...document.querySelectorAll<HTMLElement>("tr[data-assignment-key]")].find(
    (row) => row.dataset.assignmentKey === key,
  );
}

export function Assignments({
  identity,
  updating = false,
  onAddCompany,
  onShowTransactions,
}: {
  identity: Identity;
  updating?: boolean;
  onAddCompany: () => void;
  onShowTransactions: (sku: string) => void;
}) {
  const administrator = identity.account.access_role === "administrator";
  const controlsRef = useRef<HTMLDivElement>(null);
  const savedKey = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedState, setState, correctState] = useWorkspacePreference(
    "assignments:list",
    () => decodeAssignmentList(null),
    decodeAssignmentList,
  );
  const state = administrator ? savedState : memberAssignmentList(savedState);
  const companies = useMemo(
    () => new Map(identity.companies.map(({ id, name }) => [id, name])),
    [identity.companies],
  );
  const query = useQuery({
    queryKey: [
      "assignments",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
    ],
    queryFn: ({ signal }) =>
      fetchReferenceAssignments(
        identity.session.access_token,
        administrator ? "administrator" : "member",
        signal,
      ),
  });
  const items = query.data ?? NO_ASSIGNMENTS;
  const selected = items.find((row) => assignmentKey(row) === state.selected) ?? null;
  // A link or saved state naming an ID the list does not hold leaves the URL once it loads,
  // replacing the history entry so Back does not return to the stale link.
  const staleSelection = state.selected !== null && query.isSuccess && selected === null;
  useEffect(() => {
    if (staleSelection) correctState((current) => ({ ...current, selected: null, editor: null }));
  }, [staleSelection, correctState]);
  const unassignedCount = administrator ? items.filter((row) => !row.companyId).length : 0;
  const detailsFocus = useDrawerFocusReturn({
    opened: selected !== null,
    fallbackRef: controlsRef,
  });

  function change(patch: Partial<AssignmentListState>) {
    setState((current) => ({ ...current, ...patch }));
  }
  function open(row: Assignment, editing: boolean) {
    detailsFocus.rememberOpener();
    setNotice(null);
    change({ selected: assignmentKey(row), editor: editing ? newEditorDraft(row) : null });
  }
  function close() {
    change({ selected: null, editor: null });
  }

  return (
    <div className="assignments-panel">
      <WorkspaceHeader
        title="Assignments"
        status={query.isPending ? "loading" : query.isFetching || updating ? "updating" : null}
        help={<AssignmentsHelp administrator={administrator} />}
      />
      {query.isError ? (
        <ErrorAlert
          title="Could not load assignments"
          detail={loadErrorDetail(query.error)}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {notice ? (
        <Alert role="status" color="green" mb="md">
          {notice}
        </Alert>
      ) : null}
      {unassignedCount > 0 ? (
        <NeedsSetupAlert
          count={unassignedCount}
          noun={["ID", "IDs"]}
          action={{
            label: "Assign next ID",
            onClick: () => {
              const next = nextUnassigned(items);
              if (next) open(next, true);
            },
          }}
        />
      ) : null}
      <AssignmentList
        items={items}
        loaded={query.isSuccess}
        state={state}
        administrator={administrator}
        companies={companies}
        controlsRef={controlsRef}
        onChange={change}
        onSelect={(key) => {
          const row = items.find((item) => assignmentKey(item) === key);
          if (row) open(row, false);
        }}
      />
      <AssignmentDrawer
        row={selected}
        draft={administrator && state.editor?.key === state.selected ? state.editor : null}
        identity={identity}
        companies={companies}
        onDraftChange={(editor) => {
          change({ editor });
        }}
        onClose={close}
        onExitTransitionEnd={() => {
          // After a save, continue from the saved ID's row even if another control opened it.
          const row = savedKey.current ? findRow(savedKey.current) : undefined;
          savedKey.current = null;
          if (row) row.focus({ preventScroll: true });
          else detailsFocus.restoreFocus();
        }}
        onAddCompany={onAddCompany}
        onShowTransactions={(sku) => {
          close();
          onShowTransactions(sku);
        }}
        onSaved={(row, companyId) => {
          savedKey.current = assignmentKey(row);
          close();
          setNotice(`Assignment saved: ${row.nativeKey} · ${companyLabel(companyId, companies)}`);
        }}
      />
    </div>
  );
}
