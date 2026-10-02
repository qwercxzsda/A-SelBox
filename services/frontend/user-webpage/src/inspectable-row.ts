import type { HTMLAttributes } from "react";

type InspectableRowProps = Pick<
  HTMLAttributes<HTMLTableRowElement>,
  "className" | "tabIndex" | "aria-selected" | "aria-haspopup" | "onClick" | "onKeyDown"
>;

/** Shared pointer, keyboard, and focus behavior for rows that open a detail drawer. */
export function inspectableRowProps(selected: boolean, onSelect: () => void): InspectableRowProps {
  return {
    className: "inspectable-row",
    tabIndex: 0,
    "aria-selected": selected,
    "aria-haspopup": "dialog",
    onClick: (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, input, select, textarea")
      )
        return;
      if (window.getSelection()?.type === "Range") return;
      event.currentTarget.focus();
      onSelect();
    },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    },
  };
}
