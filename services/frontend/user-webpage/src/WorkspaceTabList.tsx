import { Tabs } from "@mantine/core";
import type { RefObject } from "react";
import type { Identity } from "./auth-session";
import { tabLabel, workspaceTabGroups, type WorkspaceTab } from "./workspace-tabs";

/** The workspace tabs in their groups; a separator starts every group after the first. */
export function WorkspaceTabList({
  identity,
  active,
  activeTabRef,
}: {
  identity: Identity;
  active: WorkspaceTab;
  activeTabRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Tabs.List aria-label="Workspace data">
      {workspaceTabGroups(identity).flatMap((group, groupIndex) =>
        group.map((key, index) => (
          <Tabs.Tab
            key={key}
            value={key}
            ref={active === key ? activeTabRef : undefined}
            data-group-start={groupIndex > 0 && index === 0 ? true : undefined}
          >
            {tabLabel(key)}
          </Tabs.Tab>
        )),
      )}
    </Tabs.List>
  );
}
