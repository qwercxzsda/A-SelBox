import { useId, type ReactNode } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";

/**
 * A save outcome whose recovery is reloading the saved settings, laid out like ErrorAlert: the
 * title names the outcome, the short cause beneath it, and "Refresh saved settings" on the right.
 */
export function SavedSettingsAlert({
  color,
  title,
  refreshing,
  inline = false,
  onRefresh,
  children,
}: {
  color: "orange" | "red";
  title: string;
  refreshing?: boolean;
  /** Inside a stack that already spaces its items. */
  inline?: boolean;
  onRefresh: () => unknown;
  /** The short cause, if the title does not say it all. */
  children?: ReactNode;
}) {
  const titleId = useId();
  const detailId = useId();
  return (
    <Alert
      role="alert"
      color={color}
      mb={inline ? 0 : "md"}
      title={<span id={titleId}>{title}</span>}
    >
      <Group justify="space-between" align="flex-start" gap="xs">
        <Text id={detailId} size="sm" flex="1 1 16rem">
          {children}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={refreshing}
          aria-describedby={children ? `${titleId} ${detailId}` : titleId}
          onClick={() => void onRefresh()}
        >
          Refresh saved settings
        </Button>
      </Group>
    </Alert>
  );
}
