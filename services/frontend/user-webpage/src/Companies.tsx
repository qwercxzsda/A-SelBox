import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Group, Modal, Text } from "@mantine/core";
import type { Company } from "./api";
import type { Identity } from "./auth-session";
import { CompanyCreateForm } from "./CompanyCreateForm";
import { useCompanyDirectory } from "./company-directory-context";
import { ListToolbar } from "./ListToolbar";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { lastPageIndex } from "./pagination";
import { CompanyTable } from "./CompanyTable";
import { CompanyDetails } from "./CompanyDetails";
import { DetailDrawer } from "./DetailDrawer";
import { DrawerHeading } from "./DrawerHeading";
import { useWorkspacePreference } from "./use-workspace-preference";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { decodeCompanyList, orderCompanies, type CompanyListState } from "./companies-view";
import "./Companies.css";

export function Companies({
  identity,
  returnTo,
  onReturn,
  onShowMembers,
  onShowTransactions,
  updating = false,
}: {
  identity: Identity;
  returnTo: "fees" | "accounts" | null;
  onReturn: () => void;
  onShowMembers: (companyId: string) => void;
  onShowTransactions: (sku: string) => void;
  updating?: boolean;
}) {
  const { companies, isCreating } = useCompanyDirectory();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const [state, setState] = useWorkspacePreference(
    "companies:list",
    () => decodeCompanyList(null),
    decodeCompanyList,
  );
  const [creating, setCreating] = useWorkspacePreference(
    "company-create:opened",
    () => returnTo !== null,
    (value) => value === true,
  );
  useEffect(() => {
    if (returnTo !== null) setCreating(true);
  }, [returnTo, setCreating]);
  const returnLabel =
    returnTo === "fees" ? "Current fees" : returnTo === "accounts" ? "User access" : null;
  const assignments = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const assignment of identity.assignments) {
      const skus = grouped.get(assignment.company_id) ?? new Set<string>();
      skus.add(assignment.sku);
      grouped.set(assignment.company_id, skus);
    }
    return new Map([...grouped].map(([companyId, skus]) => [companyId, [...skus].sort()]));
  }, [identity.assignments]);
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = orderCompanies(
    companies.filter(
      (company) =>
        (!state.companyIds.length || state.companyIds.includes(company.id)) &&
        [company.name, company.id].some((value) => value.toLocaleLowerCase().includes(query)),
    ),
    assignments,
    state,
  );
  const pageCount = lastPageIndex(filtered.length, state.pageSize) + 1;
  const pageIndex = Math.min(state.pageIndex, pageCount - 1);
  const start = pageIndex * state.pageSize;
  const visible = filtered.slice(start, start + state.pageSize);
  const selected = companies.find(({ id }) => id === state.selected) ?? null;
  const detailsFocus = useDrawerFocusReturn({
    opened: selected !== null && !creating,
    fallbackRef: controlsRef,
  });
  function change(patch: Partial<CompanyListState>) {
    if (patch.selected) detailsFocus.rememberOpener();
    setState((current) => ({ ...current, ...patch }));
  }
  function showControls() {
    revealSection(controlsRef.current);
  }
  function closeCreation() {
    if (!isCreating) setCreating(false);
  }
  function returnToOrigin() {
    if (isCreating) return;
    setCreating(false);
    onReturn();
  }
  function revealCompany(company: Company) {
    setNotice(null);
    const updated = [...companies.filter(({ id }) => id !== company.id), company];
    setState((current) => ({
      ...current,
      search: "",
      companyIds: [],
      pageIndex: Math.floor(
        orderCompanies(updated, assignments, current).findIndex(({ id }) => id === company.id) /
          current.pageSize,
      ),
      selected: company.id,
    }));
  }

  return (
    <div className="companies-panel">
      <WorkspaceHeader
        title="Companies"
        status={updating ? "updating" : null}
        actions={
          <Button
            variant="light"
            onClick={() => {
              setCreating(true);
            }}
          >
            Add company
          </Button>
        }
        help={
          <>
            <p>
              Open a company to review its saved SKU assignments. View members opens its User access
              list.
            </p>
            <p>
              Add company creates a company; assign SKUs in Current fees. Selecting a SKU opens its
              transactions.
            </p>
          </>
        }
      />
      {returnLabel ? (
        <Alert color="cyan" mb="md">
          <Group justify="space-between" gap="sm" align="center">
            <Text size="sm" className="company-return-guide">
              Add a company, then return to {returnLabel} to select it. Your draft is kept while you
              switch tabs.
            </Text>
            <Button variant="light" onClick={returnToOrigin}>
              Return to {returnLabel}
            </Button>
          </Group>
        </Alert>
      ) : null}
      {notice ? (
        <Alert
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          color="green"
          className="company-create-notice"
          mb="md"
        >
          {notice}
        </Alert>
      ) : null}
      <ListToolbar
        label="Company list controls"
        controlsRef={controlsRef}
        search={{
          inputRef: searchInput,
          ariaLabel: "Search companies",
          placeholder: "Company name or ID",
          value: state.search,
          onChange: (search) => {
            change({ search, pageIndex: 0 });
          },
        }}
        pageSize={state.pageSize}
        onPageSizeChange={(pageSize) => {
          change({ pageSize, pageIndex: 0 });
        }}
        pagination={{
          pageIndex,
          pageCount,
          canPrevious: pageIndex > 0,
          canNext: pageIndex < pageCount - 1,
          ariaLabel: "Companies pagination",
          onPrevious: () => {
            change({ pageIndex: pageIndex - 1 });
          },
          onNext: () => {
            change({ pageIndex: pageIndex + 1 });
          },
          onPageChange: (pageIndex) => {
            change({ pageIndex });
          },
        }}
        rowCount={visible.length}
        totalCount={filtered.length}
        items="companies"
      />
      <CompanyTable
        companies={companies}
        visible={visible}
        assignments={assignments}
        state={state}
        onChange={change}
        searchInput={searchInput}
      />
      {visible.length > 10 || pageIndex > 0 ? (
        <ListPageNavigation
          labels={{
            navigation: "Company list navigation at bottom",
            items: "companies",
            back: "Back to company filters",
          }}
          pageIndex={pageIndex}
          pageCount={pageCount}
          canPrevious={pageIndex > 0}
          canNext={pageIndex < pageCount - 1}
          onBackToFilters={showControls}
          onPageChange={(pageIndex) => {
            change({ pageIndex });
            showControls();
          }}
        />
      ) : null}
      <DetailDrawer
        opened={selected !== null && !creating}
        title={<DrawerHeading title="Company details" context={selected?.name ?? ""} />}
        closeLabel="Close company details"
        size="min(720px, 100vw)"
        returnFocus={false}
        onClose={() => {
          change({ selected: null });
        }}
        onExitTransitionEnd={detailsFocus.restoreFocus}
      >
        {selected ? (
          <CompanyDetails
            key={selected.id}
            company={selected}
            skus={assignments.get(selected.id) ?? []}
            onShowMembers={(id) => {
              change({ selected: null });
              onShowMembers(id);
            }}
            onShowTransactions={(sku) => {
              change({ selected: null });
              onShowTransactions(sku);
            }}
            onDeleted={(company, deleted) => {
              setNotice(
                `${deleted ? "Company deleted" : "Company already deleted"}: ${company.name}`,
              );
              setState((current) => ({
                ...current,
                companyIds: current.companyIds.filter((id) => id !== company.id),
                selected: null,
              }));
            }}
          />
        ) : null}
      </DetailDrawer>
      <Modal
        opened={creating}
        onClose={closeCreation}
        centered
        size="min(560px, calc(100vw - 32px))"
        padding="lg"
        title="Add company"
        returnFocus={selected === null}
        closeButtonProps={{ "aria-label": "Close company creation", disabled: isCreating }}
        closeOnEscape={!isCreating}
        closeOnClickOutside={!isCreating}
      >
        <CompanyCreateForm returnLabel={returnLabel} onCreated={revealCompany} />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" disabled={isCreating} onClick={closeCreation}>
            Done
          </Button>
          {returnLabel ? (
            <Button disabled={isCreating} onClick={returnToOrigin}>
              Return to {returnLabel}
            </Button>
          ) : null}
        </Group>
      </Modal>
    </div>
  );
}
