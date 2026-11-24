import { useState } from "react";
import { Badge, Button, Checkbox, Group, Select, Table } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchAssignmentStatus } from "./api";
import { ASSIGNMENT_KINDS, type Assignment, type AssignmentKind } from "./api/allocations";
import type { Identity } from "./auth-session";
import { sourceCodeLabel } from "./categories";
import { DetailData } from "./DetailData";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { AssignmentEditor } from "./AssignmentEditor";

export function Assignments({ identity }: { identity: Identity }) {
  const [kind, setKind] = useState<AssignmentKind | "">("");
  const [warningsOnly, setWarningsOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const query = useQuery({
    queryKey: ["assignments", identity.session.user.id, kind, warningsOnly, page],
    queryFn: ({ signal }) =>
      fetchAssignmentStatus(identity.session.access_token, { kind, warningsOnly }, page, signal),
    enabled: identity.account.access_role === "administrator",
  });
  if (identity.account.access_role !== "administrator") return null;
  const rows = query.data?.rows ?? [];
  return (
    <>
      <WorkspaceHeader
        title="Assignments"
        help={
          <p>
            Assign each campaign, promotion or shipment to one company. Warnings identify missing
            assignments and product ownership conflicts. SKU ownership is managed in Current fees.
          </p>
        }
      />
      <Group mb="md">
        <Select
          label="Source"
          value={kind || "ALL"}
          data={[
            { value: "ALL", label: "All sources" },
            ...ASSIGNMENT_KINDS.map((k) => ({ value: k, label: sourceCodeLabel(k) })),
          ]}
          onChange={(v) => {
            setKind(ASSIGNMENT_KINDS.find((k) => k === v) ?? "");
            setPage(0);
          }}
          allowDeselect={false}
        />
        <Checkbox
          label="Warnings only"
          checked={warningsOnly}
          onChange={(e) => {
            setWarningsOnly(e.currentTarget.checked);
            setPage(0);
          }}
        />
      </Group>
      <DetailData
        query={query}
        label="assignments"
        rowCount={rows.length}
        emptyMessage={warningsOnly ? "No assignments need attention." : "No matching assignments."}
        pagination={{
          pageIndex: page,
          totalCount: query.data?.totalCount ?? null,
          onPageChange: setPage,
        }}
      >
        {rows.length > 0 && (
          <Table.ScrollContainer minWidth={650}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  {["Source", "Seller account", "Reference ID", "Company", "Status"].map((t) => (
                    <Table.Th key={t}>{t}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr
                    key={JSON.stringify([
                      row.kind,
                      row.sellerNamespace,
                      row.amazonScope,
                      row.nativeKey,
                    ])}
                  >
                    <Table.Td>{sourceCodeLabel(row.kind)}</Table.Td>
                    <Table.Td>
                      {row.sellerNamespace} · {row.amazonScope}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() => {
                          setSelected(row);
                        }}
                      >
                        {row.nativeKey}
                      </Button>
                    </Table.Td>
                    <Table.Td>
                      {identity.companies.find((c) => c.id === row.companyId)?.name ?? "Unassigned"}
                    </Table.Td>
                    <Table.Td>
                      {row.warning ? (
                        <Badge color="orange">{sourceCodeLabel(row.warning)}</Badge>
                      ) : row.origin ? (
                        sourceCodeLabel(row.origin)
                      ) : (
                        "Assigned"
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </DetailData>
      {selected && (
        <AssignmentEditor
          row={selected}
          identity={identity}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </>
  );
}
