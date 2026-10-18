import { Button, Group, Text } from "@mantine/core";

export function FeeDraftStatus({
  draftCount,
  unfinishedCount,
  reviewDisabled,
  onResume,
  onReview,
}: {
  draftCount: number;
  unfinishedCount: number;
  reviewDisabled: boolean;
  onResume: () => void;
  onReview: () => void;
}) {
  const hasChanges = draftCount > 0 || unfinishedCount > 0;
  const summary = hasChanges
    ? [
        draftCount ? `${String(draftCount)} SKU ${draftCount === 1 ? "draft" : "drafts"}` : "",
        unfinishedCount
          ? `${String(unfinishedCount)} unfinished ${unfinishedCount === 1 ? "edit" : "edits"}`
          : "",
        "not saved yet",
      ]
        .filter(Boolean)
        .join(" · ")
    : "No unsaved changes.";
  return (
    <Group
      justify="space-between"
      className="fee-draft-status"
      data-dirty={hasChanges}
      role="region"
      aria-label="Fee changes"
    >
      <Text size="sm">{summary}</Text>
      <Group gap="xs">
        {unfinishedCount > 0 ? (
          <Button
            variant="light"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onResume();
            }}
          >
            Resume unfinished edit
          </Button>
        ) : null}
        <Button
          disabled={draftCount === 0 || reviewDisabled}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onReview();
          }}
        >
          Review changes{draftCount ? ` (${String(draftCount)})` : ""}
        </Button>
      </Group>
    </Group>
  );
}
