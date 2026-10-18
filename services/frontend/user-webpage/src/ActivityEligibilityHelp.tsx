import { Text } from "@mantine/core";

export function ActivityEligibilityHelp() {
  return (
    <Text size="xs" c="dimmed" mb="sm">
      Activity indicates whether a component counts within its capture. Original sales and fees
      count, including funds still held by Amazon. Linked releases and bank transfers are exclusive.
      A released status alone does not exclude a directly posted fee. Current capture selection,
      mature dates and company ownership separately determine payout eligibility. Open a row for its
      status and linked transaction IDs.
    </Text>
  );
}
