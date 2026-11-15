import { Modal, Text } from "@mantine/core";
import { DateFilter } from "./DateFilter";
import type { DateRange } from "./summary-periods";

export function SummaryDatePicker({
  opened,
  onClose,
  dateRange,
  onDatesChange,
}: {
  opened: boolean;
  onClose: () => void;
  dateRange: DateRange;
  onDatesChange: (range: DateRange) => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Choose summary dates"
      closeButtonProps={{ "aria-label": "Close summary dates" }}
      centered
    >
      <Text size="sm" c="dimmed" mb="sm">
        These UTC dates also filter the transaction list. Clear dates to restore the default trend
        range.
      </Text>
      <DateFilter
        filter={{
          kind: "date",
          from: dateRange.from,
          to: dateRange.to,
          onChange: (from, to) => {
            onDatesChange({ from, to });
          },
        }}
        onClose={onClose}
      />
    </Modal>
  );
}
