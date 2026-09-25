import { Text, type TextProps } from "@mantine/core";

/** Keep the same space, including wrapped lines, while background updates come and go. */
export function UpdateStatus({
  active,
  children,
  mb,
}: {
  active: boolean;
  children: string;
  mb?: TextProps["mb"];
}) {
  return (
    <Text
      role="status"
      size="xs"
      c="dimmed"
      mb={mb}
      aria-hidden={!active}
      style={{ visibility: active ? "visible" : "hidden" }}
    >
      {children}
    </Text>
  );
}
