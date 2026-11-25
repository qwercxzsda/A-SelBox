import type { ReactNode } from "react";
import { Text } from "@mantine/core";
import "./ListRowName.css";

/**
 * The name that identifies a list row, such as a company or a user's email. It inherits the cell's
 * size and line height, so its text lines up with the other cells of the row.
 */
export function ListRowName({ children }: { children: ReactNode }) {
  return (
    <Text inherit fw={500} className="list-row-name">
      {children}
    </Text>
  );
}
