import { Alert, Button, Group, NativeSelect, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPayoutPolicy, generatePayoutReports, type DatasetFilters } from "./api";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";

export function PayoutControls({
  identity,
  filters,
  onChange,
}: {
  identity: Identity;
  filters: DatasetFilters;
  onChange: (filters: DatasetFilters) => void;
}) {
  const client = useQueryClient();
  const administrator = identity.account.access_role === "operator";
  const companyId = filters.companyIds[0] ?? "";
  const month = filters.dateFrom.slice(0, 7);
  const policy = useQuery({
    queryKey: ["payout-policy", identity.session.user.id],
    queryFn: ({ signal }) => fetchPayoutPolicy(identity.session.access_token, signal),
    staleTime: 60_000,
  });
  const generation = useMutation({
    mutationFn: () =>
      generatePayoutReports(identity.session.access_token, companyId, `${month}-01`),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          ["dataset", "dataset-count"].includes(String(query.queryKey[0])) &&
          query.queryKey[4] === "payouts",
      });
    },
  });
  const eligible = !!month && !!policy.data && `${month}-01` <= policy.data.latest_month;
  const createdReports = generation.data?.filter(({ created }) => created).length ?? 0;
  const reusedReports = (generation.data?.length ?? 0) - createdReports;
  function change(next: DatasetFilters) {
    generation.reset();
    onChange(next);
  }
  return (
    <>
      <Group align="end" mb="sm">
        {administrator ? (
          <NativeSelect
            label="Report company"
            value={companyId}
            disabled={generation.isPending}
            data={[
              { value: "", label: "All companies" },
              ...identity.companies.map(({ id, name }) => ({ value: id, label: name })),
            ]}
            onChange={(event) => {
              change({
                ...filters,
                companyIds: event.currentTarget.value ? [event.currentTarget.value] : [],
              });
            }}
          />
        ) : null}
        <TextInput
          label="Report month"
          type="month"
          value={month}
          disabled={generation.isPending}
          onChange={(event) => {
            const date = event.currentTarget.value ? `${event.currentTarget.value}-01` : "";
            change({ ...filters, dateFrom: date, dateTo: date });
          }}
        />
        {administrator ? (
          <Button
            loading={generation.isPending}
            disabled={!companyId || !eligible}
            onClick={() => {
              generation.mutate();
            }}
          >
            Generate payout reports
          </Button>
        ) : null}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        {policy.data
          ? `Mature cutoff period: ${String(policy.data.mature_cutoff_months)} calendar months (assumed). Mature cutoff date: ${policy.data.mature_cutoff_date} (UTC). The month must end before the mature cutoff date.`
          : policy.isPending
            ? "Loading payout eligibility…"
            : null}
        {administrator
          ? " Generates all reports for the selected company and month."
          : " Your company’s saved reports are available below."}
      </Text>
      {policy.isError ? (
        <Alert color="red" mb="md">
          Could not load payout eligibility.
          <Button variant="subtle" onClick={() => void policy.refetch()}>
            Retry eligibility
          </Button>
        </Alert>
      ) : null}
      {month && policy.data && !eligible ? (
        <Alert color="orange" mb="md">
          This month includes recent dates and cannot be used for a payout report.
        </Alert>
      ) : null}
      {generation.isError ? (
        <Alert role="alert" color="red" mb="md">
          {getErrorMessage(generation.error)}
        </Alert>
      ) : null}
      {generation.isSuccess ? (
        <Alert role="status" color="green" mb="md">
          {createdReports > 0
            ? `${String(createdReports)} payout ${createdReports === 1 ? "report" : "reports"} saved.`
            : "Reports unchanged. No new reports saved."}
          {reusedReports > 0
            ? ` ${String(reusedReports)} existing payout ${reusedReports === 1 ? "report" : "reports"} reused.`
            : null}
        </Alert>
      ) : null}
    </>
  );
}
