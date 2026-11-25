import { Alert, Button, Group, Text } from "@mantine/core";

/** How many records in a list need setup ("2 SKUs need setup"), with a shortcut to the next one. */
export function NeedsSetupAlert({
  count,
  noun,
  action,
}: {
  count: number;
  /** The record's name, singular and plural: ["SKU", "SKUs"]. */
  noun: readonly [string, string];
  action?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  return (
    <Alert color="orange" mb="md">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={500}>
          {count} {count === 1 ? `${noun[0]} needs` : `${noun[1]} need`} setup
        </Text>
        {action ? (
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={action.disabled}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              action.onClick();
            }}
          >
            {action.label}
          </Button>
        ) : null}
      </Group>
    </Alert>
  );
}
