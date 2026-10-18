import { Button, Group, Text } from "@mantine/core";

/** Paging for bounded lookups that return a next-page flag instead of an exact count. */
export function LookupPagination({
  pageIndex,
  hasNext,
  disabled,
  onPageChange,
  label,
  pageLabel = "Page",
  mt = "sm",
}: {
  pageIndex: number;
  hasNext: boolean;
  disabled: boolean;
  onPageChange: (page: number) => void;
  label: string;
  pageLabel?: string;
  mt?: "xs" | "sm";
}) {
  return (
    <Group component="nav" aria-label={`Pagination for ${label}`} mt={mt} justify="space-between">
      <Text size="xs">
        {pageLabel} {pageIndex + 1}
      </Text>
      <Group gap="xs">
        <Button
          size="xs"
          variant="default"
          disabled={pageIndex === 0 || disabled}
          onClick={() => {
            onPageChange(pageIndex - 1);
          }}
        >
          Previous {label}
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={!hasNext || disabled}
          onClick={() => {
            onPageChange(pageIndex + 1);
          }}
        >
          Next {label}
        </Button>
      </Group>
    </Group>
  );
}
