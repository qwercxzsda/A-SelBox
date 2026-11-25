import { useId, type ReactNode, type Ref } from "react";
import { Alert, Button, Group, Text, type MantineSpacing } from "@mantine/core";

type Recovery =
  | { onRetry: () => void; retrying?: boolean; retriesAutomatically?: never }
  /** The read repeats on its own, so the alert says so and offers no Retry. */
  | { retriesAutomatically: true; onRetry?: never; retrying?: never }
  /** A failed save: its own Save button tries again. */
  | { onRetry?: never; retrying?: never; retriesAutomatically?: never };

/**
 * The one failure alert: a title naming what failed ("Could not load inventory", "Could not save
 * the assignment"), the short cause beneath it, and at most one Retry (subtle, compact, accent)
 * on the right.
 */
export function ErrorAlert({
  ref,
  title,
  detail,
  onDismiss,
  mb = "md",
  ...recovery
}: {
  /** Makes the alert focusable, so the feedback of an action can take focus. */
  ref?: Ref<HTMLDivElement>;
  title: string;
  /** The short cause (`loadErrorDetail`), or a table when several reads failed. */
  detail?: ReactNode;
  /** Gives up on a failed selection; shown as the alert's close button. */
  onDismiss?: () => void;
  /** 0 where a Stack already spaces the alert. */
  mb?: MantineSpacing;
} & Recovery) {
  const titleId = useId();
  const detailId = useId();
  return (
    <Alert
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      color="red"
      role="alert"
      mb={mb}
      title={<span id={titleId}>{title}</span>}
      withCloseButton={onDismiss !== undefined}
      closeButtonLabel="Dismiss"
      onClose={onDismiss}
    >
      <Group justify="space-between" align="flex-start" gap="xs">
        {/* A block, so the cause may be a table of failures. */}
        <Text id={detailId} component="div" size="sm" flex="1 1 16rem">
          {detail}
          {recovery.retriesAutomatically ? <> Retrying automatically.</> : null}
        </Text>
        {recovery.onRetry ? (
          // Every Retry reads the same; the failure it retries is its description.
          <Button
            variant="subtle"
            size="compact-sm"
            disabled={recovery.retrying}
            aria-describedby={`${titleId} ${detailId}`}
            onClick={recovery.onRetry}
          >
            Retry
          </Button>
        ) : null}
      </Group>
    </Alert>
  );
}
