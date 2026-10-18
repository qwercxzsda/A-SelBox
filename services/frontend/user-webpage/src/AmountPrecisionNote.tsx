import { Text } from "@mantine/core";

export function AmountPrecisionNote() {
  return (
    <Text size="xs" c="dimmed" mt="sm" role="note">
      Displayed amounts are rounded to 2 decimals. Totals use original precision, so displayed rows
      may not add up exactly to the displayed total.
    </Text>
  );
}
