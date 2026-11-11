import type { ReactNode } from "react";
import { Group, Title } from "@mantine/core";
import { HelpPopover } from "./HelpPopover";
import { LoadingStatus, type LoadingState } from "./LoadingStatus";

export function WorkspaceHeader({
  title,
  help,
  actions,
  status,
}: {
  title: string;
  help: ReactNode;
  actions?: ReactNode;
  status?: LoadingState;
}) {
  return (
    <header className="workspace-header">
      <Group className="workspace-header-title" gap={6} wrap="nowrap">
        <Title order={2}>{title}</Title>
        <HelpPopover label={`${title} help`}>{help}</HelpPopover>
        <LoadingStatus state={status} />
      </Group>
      {actions ? <div className="workspace-header-actions">{actions}</div> : null}
    </header>
  );
}
