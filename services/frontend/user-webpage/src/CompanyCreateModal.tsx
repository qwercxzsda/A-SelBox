import { Button, Group, Modal } from "@mantine/core";
import type { Company } from "./api";
import { CompanyCreateForm } from "./CompanyCreateForm";
import { useCompanyDirectory } from "./company-directory-context";

/** Add company stays open after a save so several companies can be added in a row. */
export function CompanyCreateModal({
  opened,
  returnLabel,
  returnFocus,
  onClose,
  onReturn,
  onCreated,
}: {
  opened: boolean;
  /** The tab that sent the administrator here, offered as the way back. */
  returnLabel: string | null;
  returnFocus: boolean;
  onClose: () => void;
  onReturn: () => void;
  onCreated: (company: Company) => void;
}) {
  const { isCreating } = useCompanyDirectory();
  function close() {
    if (!isCreating) onClose();
  }
  return (
    <Modal
      opened={opened}
      onClose={close}
      centered
      size="min(560px, calc(100vw - 32px))"
      title="Add company"
      returnFocus={returnFocus}
      closeButtonProps={{ "aria-label": "Close company creation", disabled: isCreating }}
      closeOnEscape={!isCreating}
      closeOnClickOutside={!isCreating}
    >
      <CompanyCreateForm onCreated={onCreated} />
      <Group justify="flex-end" mt="lg">
        <Button variant="default" disabled={isCreating} onClick={close}>
          Done
        </Button>
        {returnLabel ? (
          <Button disabled={isCreating} onClick={onReturn}>
            Return to {returnLabel}
          </Button>
        ) : null}
      </Group>
    </Modal>
  );
}
