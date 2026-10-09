import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  CloseButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { Company } from "./api";
import type { Identity } from "./auth-session";
import { CompanyCreateForm } from "./CompanyCreateForm";
import { useCompanyDirectory } from "./company-directory-context";
import { PaginationBar } from "./PaginationBar";
import { lastPageIndex } from "./pagination";
import { RowsSelect } from "./RowsSelect";
import { CompanyDetails } from "./CompanyDetails";
import { useWorkspacePreference } from "./use-workspace-preference";
import { PAGE_SIZES } from "./view-model";
import { WorkspaceIntro } from "./WorkspaceIntro";
import "./Companies.css";

interface CompanyListState {
  search: string;
  pageSize: number;
  pageIndex: number;
  expanded: string[];
}

function decodeList(value: unknown): CompanyListState {
  const saved =
    typeof value === "object" && value !== null ? (value as Partial<CompanyListState>) : {};
  return {
    search: typeof saved.search === "string" ? saved.search : "",
    pageSize: PAGE_SIZES.find((size) => size === saved.pageSize) ?? PAGE_SIZES[0],
    pageIndex:
      typeof saved.pageIndex === "number" && Number.isSafeInteger(saved.pageIndex)
        ? Math.max(0, saved.pageIndex)
        : 0,
    expanded: Array.isArray(saved.expanded)
      ? saved.expanded.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export function Companies({
  identity,
  returnTo,
  onReturn,
  onShowMembers,
  onShowTransactions,
}: {
  identity: Identity;
  returnTo: "fees" | "accounts" | null;
  onReturn: () => void;
  onShowMembers: (companyId: string) => void;
  onShowTransactions: (sku: string) => void;
}) {
  const { companies } = useCompanyDirectory();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const [state, setState] = useWorkspacePreference(
    "companies:list",
    () => decodeList(null),
    decodeList,
  );
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
  const filtered = companies.filter((company) =>
    [company.name, company.id].some((value) => value.toLocaleLowerCase().includes(query)),
  );
  const pageCount = lastPageIndex(filtered.length, state.pageSize) + 1;
  const pageIndex = Math.min(state.pageIndex, pageCount - 1);
  const start = pageIndex * state.pageSize;
  const visible = filtered.slice(start, start + state.pageSize);
  function change(patch: Partial<CompanyListState>) {
    setState((current) => ({ ...current, ...patch }));
  }
  function revealCompany(company: Company) {
    setNotice(null);
    const updated = [...companies.filter(({ id }) => id !== company.id), company].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    setState((current) => ({
      ...current,
      search: "",
      pageIndex: Math.floor(updated.findIndex(({ id }) => id === company.id) / current.pageSize),
      expanded: [...new Set([...current.expanded, company.id])],
    }));
  }

  return (
    <Stack gap="md" className="companies-panel">
      <WorkspaceIntro
        title="Company directory"
        description="Manage companies and review their saved SKU assignments."
      />
      {returnLabel ? (
        <Alert color="cyan">
          <Group justify="space-between" gap="sm" align="center">
            <Text size="sm" className="company-return-guide">
              Add a company below, then return to {returnLabel} to select it. Your draft is kept
              while you switch tabs.
            </Text>
            <Button variant="light" onClick={onReturn}>
              Return to {returnLabel}
            </Button>
          </Group>
        </Alert>
      ) : null}
      <CompanyCreateForm returnLabel={returnLabel} onCreated={revealCompany} />
      {notice ? (
        <Alert
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          color="green"
          className="company-create-notice"
        >
          {notice}
        </Alert>
      ) : null}
      <Group align="flex-end" gap="md" className="company-list-toolbar">
        <TextInput
          label="Search companies"
          placeholder="Company name or ID"
          className="company-list-search"
          value={state.search}
          rightSectionPointerEvents="auto"
          rightSection={
            state.search ? (
              <CloseButton
                aria-label="Clear search"
                onClick={() => {
                  change({ search: "", pageIndex: 0 });
                }}
              />
            ) : null
          }
          onChange={(event) => {
            change({ search: event.currentTarget.value, pageIndex: 0 });
          }}
        />
        <RowsSelect
          value={state.pageSize}
          onChange={(pageSize) => {
            change({ pageSize, pageIndex: 0 });
          }}
        />
        <Button
          variant="subtle"
          size="compact-sm"
          className="company-list-collapse"
          disabled={state.expanded.length === 0}
          onClick={() => {
            change({ expanded: [] });
          }}
        >
          Collapse all
        </Button>
      </Group>
      <PaginationBar
        pageIndex={pageIndex}
        pageCount={pageCount}
        canPrevious={pageIndex > 0}
        canNext={pageIndex < pageCount - 1}
        summary={`${filtered.length ? String(start + 1) : "0"}-${String(start + visible.length)} of ${filtered.length.toLocaleString("en-US")} companies`}
        ariaLabel="Companies pagination"
        onPrevious={() => {
          change({ pageIndex: pageIndex - 1 });
        }}
        onNext={() => {
          change({ pageIndex: pageIndex + 1 });
        }}
        onPageChange={(pageIndex) => {
          change({ pageIndex });
        }}
      />
      {visible.length ? (
        <Accordion
          multiple
          variant="separated"
          className="company-list"
          value={state.expanded}
          onChange={(expanded) => {
            change({ expanded });
          }}
        >
          {visible.map((company) => {
            const skus = assignments.get(company.id) ?? [];
            return (
              <Accordion.Item key={company.id} value={company.id}>
                <Accordion.Control aria-label={`Show details for ${company.name}`}>
                  <Group justify="space-between" gap="xs" className="company-list-summary">
                    <Text fw={600} size="sm" className="company-list-name">
                      {company.name}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {skus.length.toLocaleString("en-US")} assigned{" "}
                      {skus.length === 1 ? "SKU" : "SKUs"}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {state.expanded.includes(company.id) ? (
                    <CompanyDetails
                      company={company}
                      skus={skus}
                      onShowMembers={onShowMembers}
                      onShowTransactions={onShowTransactions}
                      onDeleted={(company, deleted) => {
                        setNotice(
                          `${deleted ? "Company deleted" : "Company already deleted"}: ${company.name}`,
                        );
                        setState((current) => ({
                          ...current,
                          expanded: current.expanded.filter((id) => id !== company.id),
                        }));
                      }}
                    />
                  ) : null}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed">
              {query
                ? "No companies match your search."
                : "No companies yet. Add your first company above."}
            </Text>
            {query ? (
              <Button
                variant="subtle"
                onClick={() => {
                  change({ search: "", pageIndex: 0 });
                }}
              >
                Clear search
              </Button>
            ) : null}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
