import { useRef } from "react";
import { Button } from "@mantine/core";
import type { Assignment } from "./api/assignment-types";
import type { Identity } from "./auth-session";
import { AssignmentDetails } from "./AssignmentDetails";
import { AssignmentEditor } from "./AssignmentEditor";
import { assignmentContext, newEditorDraft, type AssignmentEditorDraft } from "./assignments-view";
import { DetailDrawer } from "./DetailDrawer";
import "./EditingDrawer.css";

// Like Fee details: details scroll in the body, the editor keeps a sticky footer.
const DRAWER_LAYOUT = {
  content: "editing-drawer-content",
  body: "editing-drawer-body",
};

/** Assignment details, swapped in place for the editor while an administrator edits. */
export function AssignmentDrawer({
  row,
  draft,
  identity,
  companies,
  onDraftChange,
  onClose,
  onExitTransitionEnd,
  onAddCompany,
  onShowTransactions,
  onSaved,
}: {
  row: Assignment | null;
  draft: AssignmentEditorDraft | null;
  identity: Identity;
  companies: Map<string, string>;
  onDraftChange: (draft: AssignmentEditorDraft | null) => void;
  onClose: () => void;
  onExitTransitionEnd: () => void;
  onAddCompany: () => void;
  onShowTransactions: (sku: string) => void;
  onSaved: (row: Assignment, companyId: string | null) => void;
}) {
  const editing = row !== null && draft !== null;
  const editButton = useRef<HTMLButtonElement>(null);
  const editAction =
    row && !editing && identity.account.access_role === "administrator" ? (
      <Button
        ref={editButton}
        size="xs"
        aria-label={`Edit ${row.nativeKey}`}
        onClick={() => {
          onDraftChange(newEditorDraft(row));
        }}
      >
        Edit
      </Button>
    ) : undefined;
  return (
    <DetailDrawer
      opened={row !== null}
      title={editing ? "Assignment editor" : "Assignment details"}
      context={row ? assignmentContext(row) : ""}
      width="record"
      headerActions={editAction}
      classNames={DRAWER_LAYOUT}
      returnFocus={false}
      onClose={onClose}
      onExitTransitionEnd={onExitTransitionEnd}
    >
      {row && draft ? (
        <AssignmentEditor
          key={draft.key}
          row={row}
          draft={draft}
          identity={identity}
          onDraftChange={onDraftChange}
          onCancel={() => {
            onDraftChange(null);
          }}
          onAddCompany={onAddCompany}
          onSaved={(companyId) => {
            onSaved(row, companyId);
          }}
        />
      ) : row ? (
        <AssignmentDetails
          row={row}
          identity={identity}
          companies={companies}
          editButtonRef={editButton}
          onShowTransactions={onShowTransactions}
        />
      ) : null}
    </DetailDrawer>
  );
}
