import type { ReactNode } from "react";
import { Group, Title } from "@mantine/core";
import { HelpPopover } from "./HelpPopover";

export function WorkspaceHeader({
  title,
  help,
  actions,
}: {
  title: string;
  help: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <Group className="workspace-header-title" gap={6} wrap="nowrap">
        <Title order={2}>{title}</Title>
        <HelpPopover label={`${title} help`}>{help}</HelpPopover>
      </Group>
      {actions ? <div className="workspace-header-actions">{actions}</div> : null}
    </header>
  );
}
