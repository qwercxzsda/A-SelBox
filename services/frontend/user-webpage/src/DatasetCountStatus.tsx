import { Button, Text } from "@mantine/core";
import { LoadingStatus } from "./LoadingStatus";

/** Page rows stay usable while their independent count loads or recovers. */
export function DatasetCountStatus({
  isError,
  isFetching,
  items,
  onRetry,
}: {
  isError: boolean;
  isFetching: boolean;
  items: "rows" | "reports";
  onRetry: () => void;
}) {
  return isError ? (
    <>
      <Text size="xs" c="red" role="status">
        {items === "reports" ? "Report" : "Row"} count unavailable.
      </Text>
      <Button size="compact-xs" variant="subtle" onClick={onRetry}>
        Retry count
      </Button>
    </>
  ) : (
    <LoadingStatus state={isFetching ? "updating" : null} />
  );
}
