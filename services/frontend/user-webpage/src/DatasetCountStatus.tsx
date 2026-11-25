import { useId } from "react";
import { Button, Text } from "@mantine/core";
import { LoadingStatus } from "./LoadingStatus";

/** Page rows stay usable while their independent count loads or recovers. */
export function DatasetCountStatus({
  isError,
  isFetching,
  onRetry,
}: {
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  const messageId = useId();
  return isError ? (
    <>
      <Text id={messageId} size="xs" c="red" role="status">
        Count unavailable
      </Text>
      {/* The same Retry as ErrorAlert's; the failure it retries is its description. */}
      <Button size="compact-sm" variant="subtle" aria-describedby={messageId} onClick={onRetry}>
        Retry
      </Button>
    </>
  ) : (
    <LoadingStatus state={isFetching ? "updating" : null} />
  );
}
