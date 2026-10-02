import { useId, type ReactNode, type Ref } from "react";
import { Group, Text, Title, UnstyledButton } from "@mantine/core";
import "./DetailTable.css";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailOpen } from "./detail-view-state";

export function DetailSection({
  title,
  label = title,
  description,
  actions,
  collapsible = false,
  children,
  ref,
  stateKey,
}: {
  title: string;
  label?: string;
  description?: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
  stateKey?: string;
}) {
  const [savedOpen, setOpened] = useWorkspacePreference(
    `${stateKey ?? label}:expanded`,
    () => false,
    decodeDetailOpen,
  );
  const opened = !collapsible || savedOpen;
  const contentId = useId();
  return (
    <section ref={ref} tabIndex={-1} className="detail-section" aria-label={label}>
      <Group className="detail-section-header" justify="space-between" gap="sm">
        <Title order={4} className="detail-section-title">
          {collapsible ? (
            <UnstyledButton
              className="detail-section-toggle"
              aria-expanded={opened}
              aria-controls={contentId}
              onClick={() => {
                setOpened(!opened);
              }}
            >
              <span>{title}</span>
              <svg
                className="detail-section-chevron"
                data-opened={opened}
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="m4 6 4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </UnstyledButton>
          ) : (
            title
          )}
        </Title>
        {opened ? actions : null}
      </Group>
      <div id={contentId} className="detail-section-body" hidden={!opened}>
        {opened ? (
          <>
            {description ? (
              <Text component="div" className="detail-section-description">
                {description}
              </Text>
            ) : null}
            {children}
          </>
        ) : null}
      </div>
    </section>
  );
}
