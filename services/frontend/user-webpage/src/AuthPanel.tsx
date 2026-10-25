import type { ReactNode } from "react";
import { Paper, Stack } from "@mantine/core";
import "./AuthPanel.css";

/** Keep all authentication forms readable without widening a narrow viewport. */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <div className="login-shell auth-panel-shell">
      <Paper
        className="auth-panel"
        component="section"
        p="xl"
        shadow="md"
        withBorder
        w="100%"
        maw={480}
      >
        <Stack gap="md">{children}</Stack>
      </Paper>
    </div>
  );
}
