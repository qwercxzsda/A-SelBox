import { NativeSelect } from "@mantine/core";
import { PAGE_SIZES } from "./view-model";

/** Keep the page-size label, choices, and control width consistent across lists. */
export function RowsSelect({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (pageSize: number) => void;
  className?: string;
}) {
  return (
    <NativeSelect
      className={className}
      label="Rows"
      w={80}
      value={value}
      data={PAGE_SIZES.map(String)}
      onChange={(event) => {
        onChange(Number(event.currentTarget.value));
      }}
    />
  );
}
