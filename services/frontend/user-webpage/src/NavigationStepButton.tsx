import { Button, type ButtonProps } from "@mantine/core";

/** Keep focus on an unavailable step without allowing another navigation request. */
export function NavigationStepButton({
  label,
  disabled,
  onClick,
  size,
}: {
  label: "Previous" | "Next";
  disabled: boolean;
  onClick: () => void;
  size?: ButtonProps["size"];
}) {
  return (
    <Button
      variant="default"
      size={size}
      aria-disabled={disabled}
      data-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {label}
    </Button>
  );
}
