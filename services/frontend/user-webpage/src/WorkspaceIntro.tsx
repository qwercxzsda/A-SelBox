import type { ReactNode } from "react";
import { Group, Text, Title } from "@mantine/core";

export function WorkspaceIntro({
  title,
  description,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Group className="ui-workspace-intro" justify="space-between" align="flex-start" gap="md">
      <div className="ui-workspace-intro-copy">
        {title ? (
          <Title order={2} className="ui-workspace-intro-title">
            {title}
          </Title>
        ) : null}
        {description ? (
          <Text component="div" role="note" className="ui-workspace-intro-description">
            {description}
          </Text>
        ) : null}
      </div>
      {actions}
    </Group>
  );
}
