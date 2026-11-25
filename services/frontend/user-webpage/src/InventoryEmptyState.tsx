import type { RefObject } from "react";
import type { InventoryCapture } from "./api/inventory";
import { EmptyState } from "./EmptyState";
import { inventoryEmptyMessage } from "./inventory-coverage";

/** Why no inventory is listed, with a way back when the search or filters hide every item. */
export function InventoryEmptyState({
  captures,
  marketplaces,
  hasItems,
  member,
  onReset,
  focusTarget,
}: {
  captures: InventoryCapture[];
  marketplaces: string[];
  hasItems: boolean | undefined;
  member: boolean;
  /** Present when a search or filter is applied. */
  onReset?: () => void;
  focusTarget: RefObject<HTMLElement | null>;
}) {
  return (
    <EmptyState
      title={inventoryEmptyMessage({ captures, marketplaces, hasItems, member })}
      action={
        onReset ? { label: "Reset search and filters", focusTarget, onClick: onReset } : undefined
      }
    />
  );
}
