import { Button, Group, Text } from "@mantine/core";

/** Keep paging and a return to filters available below long lists. */
export function ListPageNavigation({
  pageIndex,
  pageCount,
  canPrevious,
  canNext,
  isBusy = false,
  labels,
  onPageChange,
  onBackToFilters,
}: {
  pageIndex: number;
  pageCount: number | null;
  canPrevious: boolean;
  canNext: boolean;
  isBusy?: boolean;
  labels: { navigation: string; items: string; back: string };
  onPageChange: (pageIndex: number) => void;
  onBackToFilters: () => void;
}) {
  return (
    <Group component="nav" aria-label={labels.navigation} justify="space-between" mt="md">
      <Button variant="subtle" aria-label={labels.back} onClick={onBackToFilters}>
        Back to filters
      </Button>
      <Group>
        <Button
          variant="default"
          aria-label={`Previous ${labels.items}`}
          disabled={!canPrevious || isBusy}
          onClick={() => {
            onPageChange(pageIndex - 1);
          }}
        >
          Previous
        </Button>
        <Text size="sm">
          Page {pageIndex + 1}
          {pageCount === null ? "" : ` of ${String(pageCount)}`}
        </Text>
        <Button
          variant="default"
          aria-label={`Next ${labels.items}`}
          disabled={!canNext || isBusy}
          onClick={() => {
            onPageChange(pageIndex + 1);
          }}
        >
          Next
        </Button>
      </Group>
    </Group>
  );
}
