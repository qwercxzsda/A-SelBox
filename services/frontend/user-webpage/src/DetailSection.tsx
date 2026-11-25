import { useId, type ReactNode, type Ref } from "react";
import { Group, Text, Title, UnstyledButton } from "@mantine/core";
import "./DetailTable.css";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailOpen } from "./detail-view-state";
import { HelpPopover } from "./HelpPopover";
import { DisclosureChevron } from "./DisclosureChevron";

export function DetailSection({
  title,
  label = title,
  description,
  help,
  actions,
  collapsible = false,
  children,
  ref,
  stateKey,
  // Drawer titles are h2 and the body repeats no record title, so sections start at h3.
  headingOrder = 3,
  opened: controlledOpened,
  onOpenedChange,
}: {
  title: string;
  label?: string;
  /** A short label only; explanations belong in `help`. */
  description?: ReactNode;
  /** Guidance behind a "?" beside the title, named "<label> help". */
  help?: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
  stateKey?: string;
  headingOrder?: 2 | 3 | 4;
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
}) {
  const [savedOpen, setOpened] = useWorkspacePreference(
    `${stateKey ?? label}:expanded`,
    () => false,
    decodeDetailOpen,
  );
  const opened = !collapsible || (controlledOpened ?? savedOpen);
  const contentId = useId();
  return (
    <section ref={ref} tabIndex={-1} className="detail-section" aria-label={label}>
      <Group className="detail-section-header" justify="space-between" gap="sm" wrap="nowrap">
        <Group className="detail-section-heading" gap={6} wrap="nowrap">
          <Title order={headingOrder} size="h4" className="detail-section-title">
            {collapsible ? (
              <UnstyledButton
                className="detail-section-toggle ui-disclosure"
                aria-expanded={opened}
                aria-controls={contentId}
                onClick={() => {
                  if (onOpenedChange) onOpenedChange(!opened);
                  else setOpened(!opened);
                }}
              >
                <DisclosureChevron expanded={opened} size={16} />
                <span>{title}</span>
              </UnstyledButton>
            ) : (
              title
            )}
          </Title>
          {help ? <HelpPopover label={`${label} help`}>{help}</HelpPopover> : null}
        </Group>
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
