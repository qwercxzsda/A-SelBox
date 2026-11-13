import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { fetchSkuConfigurationHistory, type SkuConfigurationItem } from "./api";
import type { Identity } from "./auth-session";
import { DetailSection } from "./DetailSection";
import { LoadingStatus } from "./LoadingStatus";
import { LookupPagination } from "./LookupPagination";
import { SkuFeeScheduleCard, type FeeSchedule } from "./SkuFeeScheduleCard";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";
import { getErrorMessage } from "./view-model";
import { revealSection } from "./reveal-section";

interface FeeSchedulesProps {
  identity: Identity;
  item: SkuConfigurationItem;
  savedItem: SkuConfigurationItem | null;
  companies: Map<string, string>;
  hasDraft: boolean;
}

function configurationSchedule(
  item: SkuConfigurationItem,
  status: "current" | "draft" = "current",
): FeeSchedule {
  return {
    id: status === "draft" ? "draft" : (item.terms_version_id ?? "current"),
    companyId: item.company_id,
    periods: item.periods,
    status,
  };
}

export function SkuFeeSchedules(props: FeeSchedulesProps) {
  if (props.identity.account.access_role === "administrator" && props.savedItem?.sku_id)
    return (
      <SavedFeeSchedules
        {...props}
        savedItem={{ ...props.savedItem, sku_id: props.savedItem.sku_id }}
      />
    );
  return (
    <DetailSection title="Marketplace fee periods">
      <SkuFeeScheduleCard
        sku={props.item.sku}
        schedule={configurationSchedule(props.item, props.hasDraft ? "draft" : "current")}
        companies={props.companies}
        primary
      />
    </DetailSection>
  );
}

function SavedFeeSchedules({
  identity,
  item,
  savedItem,
  companies,
  hasDraft,
}: FeeSchedulesProps & { savedItem: SkuConfigurationItem & { sku_id: string } }) {
  const section = useRef<HTMLElement>(null);
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `fees:${savedItem.sku_id}:history-page`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: [
      "sku-configuration-history",
      identity.session.user.id,
      identity.account.access_role,
      savedItem.sku_id,
      savedItem.terms_version_id,
      pageIndex,
    ],
    queryFn: ({ signal }) =>
      fetchSkuConfigurationHistory(
        identity.session.access_token,
        savedItem.sku_id,
        pageIndex,
        signal,
      ),
    staleTime: Infinity,
  });
  const schedules: FeeSchedule[] = (query.data?.versions ?? []).map((version) => ({
    id: version.id,
    companyId: version.company_id,
    periods: version.periods,
    status: version.id === savedItem.terms_version_id ? "current" : null,
    versionNumber: version.version_number,
    savedAt: version.created_at,
    reason: version.change_reason,
  }));
  if (schedules.length === 0 && pageIndex === 0) schedules.push(configurationSchedule(savedItem));
  if (hasDraft) schedules.unshift(configurationSchedule(item, "draft"));
  return (
    <DetailSection
      ref={section}
      title="Marketplace fee periods"
      description="Each saved version includes its complete fee schedule. Edit changes the current configuration."
      actions={
        <LoadingStatus state={query.isPending ? "loading" : query.isFetching ? "updating" : null} />
      }
    >
      {query.isError ? (
        <Alert color="red" role="alert">
          Could not load saved fee versions. {getErrorMessage(query.error)}
          <Button
            variant="subtle"
            onClick={() => {
              section.current?.focus({ preventScroll: true });
              void query.refetch();
            }}
          >
            Retry saved versions
          </Button>
        </Alert>
      ) : null}
      {query.isSuccess && query.data.versions.length === 0 && pageIndex > 0 ? (
        <Text c="dimmed" size="sm">
          No saved versions are available on this page.
        </Text>
      ) : null}
      <Stack gap="md">
        {schedules.map((schedule) => (
          <SkuFeeScheduleCard
            key={schedule.id}
            sku={item.sku}
            schedule={schedule}
            companies={companies}
            primary={schedule.status === "draft" || (!hasDraft && schedule.status === "current")}
          />
        ))}
      </Stack>
      {pageIndex > 0 || query.data?.hasNext ? (
        <LookupPagination
          label="saved versions"
          pageIndex={pageIndex}
          hasNext={query.data?.hasNext ?? false}
          disabled={query.isFetching}
          onPageChange={(page) => {
            setPageIndex(page);
            revealSection(section.current);
          }}
        />
      ) : null}
    </DetailSection>
  );
}
