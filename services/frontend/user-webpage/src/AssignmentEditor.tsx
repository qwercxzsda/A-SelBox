import { useState } from "react";
import { Alert, Button, Drawer, Select, Stack, Table, Text, Textarea } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setReferenceAssignment } from "./api";
import type { Assignment } from "./api/allocations";
import type { Identity } from "./auth-session";
import { sourceCodeLabel } from "./categories";
import { getErrorMessage } from "./view-model";
import { queryRevisionSources } from "./workspace-revisions";

export function AssignmentEditor({
  row,
  identity,
  onClose,
}: {
  row: Assignment;
  identity: Identity;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const companies = identity.companies;
  const [company, setCompany] = useState(row.companyId ?? row.suggestedCompanyId);
  const [memo, setMemo] = useState("");
  const save = useMutation({
    mutationFn: () => setReferenceAssignment(identity.session.access_token, row, company, memo),
    onError: async () => {
      await client.invalidateQueries({ queryKey: ["assignments"] });
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => queryRevisionSources(query.queryKey).includes("fees"),
      });
      onClose();
    },
  });
  return (
    <Drawer
      opened
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      title={sourceCodeLabel(row.kind) + " · " + row.nativeKey}
      position="right"
    >
      <Stack>
        <Text size="sm">
          {row.sellerNamespace} · {row.amazonScope}
        </Text>
        <Select
          label="Assigned company"
          value={company ?? "unassigned"}
          onChange={(value) => {
            setCompany(value === "unassigned" ? null : value);
          }}
          data={[
            { value: "unassigned", label: "Unassigned" },
            ...companies.map((c) => ({ value: c.id, label: c.name })),
          ]}
          searchable
          disabled={save.isPending}
          allowDeselect={false}
        />
        <Textarea
          label="Reason for change"
          value={memo}
          onChange={(e) => {
            setMemo(e.currentTarget.value);
          }}
          disabled={save.isPending}
        />
        {row.products.length ? (
          <Table captionSide="top">
            <Table.Caption>Product ownership</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>SKU</Table.Th>
                <Table.Th>ASIN</Table.Th>
                <Table.Th>Company</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {row.products.map((p, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{p.sku ?? "Unresolved"}</Table.Td>
                  <Table.Td>{p.asin ?? "—"}</Table.Td>
                  <Table.Td>
                    {companies.find((c) => c.id === p.company_id)?.name ?? "Unassigned"}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm">No product information is available for this ID.</Text>
        )}
        {row.warning ? <Alert color="orange">{sourceCodeLabel(row.warning)}</Alert> : null}
        {save.isError ? (
          <Alert role="alert" color="red">
            {getErrorMessage(save.error)}. Close and reopen the assignment to check the latest
            version.
          </Alert>
        ) : null}
        <Button
          disabled={company === row.companyId || !memo.trim()}
          loading={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {company ? "Save assignment" : "Clear assignment"}
        </Button>
      </Stack>
    </Drawer>
  );
}
