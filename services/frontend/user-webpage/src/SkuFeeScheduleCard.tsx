import { Badge, Group, Paper, Skeleton, Text, Title } from "@mantine/core";
import type { SkuConfigurationPeriod } from "./api";
import { SkuFeePeriods } from "./SkuFeePeriods";
import { formatRecordDate } from "./date-display";
import { companyLabel } from "./view-model";

export interface FeeSchedule {
  id: string;
  companyId: string | null;
  periods: SkuConfigurationPeriod[];
  status: "current" | "draft" | null;
  versionNumber?: number;
  savedAt?: string;
  reason?: string;
}

export function SkuFeeScheduleCard({
  sku,
  schedule,
  companies,
  primary,
  loadingVersion = false,
}: {
  sku: string;
  schedule: FeeSchedule;
  companies: Map<string, string>;
  primary: boolean;
  loadingVersion?: boolean;
}) {
  const current = schedule.status === "current";
  const version =
    schedule.versionNumber === undefined ? null : `Version ${String(schedule.versionNumber)}`;
  const title = version ?? (schedule.status === "draft" ? "Draft" : "Fee schedule");
  const label = current
    ? "Current fee schedule"
    : schedule.status === "draft"
      ? "Draft fee schedule"
      : `Saved fee version ${String(schedule.versionNumber)}`;
  const tableLabel = primary
    ? `Marketplace fees for ${sku}`
    : `Marketplace fees for ${sku} · ${schedule.versionNumber !== undefined ? `version ${String(schedule.versionNumber)}` : "current saved"}`;
  return (
    <Paper component="article" withBorder p="md" aria-label={label}>
      <Group justify="space-between" gap="xs" mb="xs">
        <Group gap="xs">
          {loadingVersion ? (
            <Skeleton width={92} height={24} aria-hidden="true" />
          ) : (
            <Title order={4} size="var(--ui-font-section)">
              {title}
            </Title>
          )}
          {current ? (
            <Badge variant="light" color="teal" c="#065f46">
              Current
            </Badge>
          ) : null}
          {schedule.status === "draft" ? (
            <Badge variant="light" color="cyan">
              Not published
            </Badge>
          ) : null}
        </Group>
        {schedule.savedAt ? (
          <Text size="xs" c="dimmed">
            <time dateTime={schedule.savedAt} title={schedule.savedAt}>
              {formatRecordDate(schedule.savedAt)}
            </time>
          </Text>
        ) : null}
      </Group>
      <Text size="sm">{companyLabel(schedule.companyId, companies)}</Text>
      {schedule.reason ? (
        <Text size="sm" c="dimmed" mt={4}>
          {schedule.reason}
        </Text>
      ) : null}
      <div className="sku-configuration-proposed-periods">
        <SkuFeePeriods item={{ sku, periods: schedule.periods }} label={tableLabel} />
      </div>
    </Paper>
  );
}
