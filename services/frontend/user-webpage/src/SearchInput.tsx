import { useRef, type RefObject } from "react";
import { CloseButton, TextInput, type CloseButtonProps, type TextInputProps } from "@mantine/core";

interface SearchInputProps extends Omit<
  TextInputProps,
  "value" | "defaultValue" | "onChange" | "rightSection" | "rightSectionPointerEvents"
> {
  inputRef?: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  clearLabel?: string;
  clearButtonSize?: CloseButtonProps["size"];
}

/** Keep the typing position when clearing removes the currently focused button. */
export function SearchInput({
  inputRef,
  value,
  onChange,
  clearLabel = "Clear search",
  clearButtonSize,
  ...props
}: SearchInputProps) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  return (
    <TextInput
      {...props}
      ref={input}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      rightSectionPointerEvents="auto"
      rightSection={
        value ? (
          <CloseButton
            aria-label={clearLabel}
            size={clearButtonSize}
            disabled={Boolean(props.disabled) || Boolean(props.readOnly)}
            onClick={() => {
              onChange("");
              input.current?.focus();
            }}
          />
        ) : undefined
      }
    />
  );
}
