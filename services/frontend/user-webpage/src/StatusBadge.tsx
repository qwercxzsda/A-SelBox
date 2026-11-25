import type { ReactNode } from "react";
import { Badge } from "@mantine/core";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** The one status badge: sentence case, caption size, and a contrast-safe tone. */
export function StatusBadge({
  tone,
  children,
  title,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="light"
      size="sm"
      tt="none"
      className={["ui-status-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
      title={title}
    >
      {children}
    </Badge>
  );
}
