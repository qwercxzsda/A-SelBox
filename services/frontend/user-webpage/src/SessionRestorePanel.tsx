import { Button, Text } from "@mantine/core";
import { AuthPanel } from "./AuthPanel";
import { ErrorAlert } from "./ErrorAlert";

export function SessionRestorePanel({
  pending,
  error,
  onRetry,
  onSignIn,
}: {
  pending: boolean;
  /** The short cause of a failed restore (`loadErrorDetail`). */
  error: string | null;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  return (
    <AuthPanel>
      {pending ? <Text role="status">Restoring session…</Text> : null}
      {error ? (
        <>
          {/* The panel's own buttons recover: Retry session, or Sign in instead. */}
          <ErrorAlert title="Could not restore your session" detail={error} mb={0} />
          <Button loading={pending} onClick={onRetry}>
            Retry session
          </Button>
        </>
      ) : null}
      <Button variant="subtle" onClick={onSignIn}>
        Sign in instead
      </Button>
    </AuthPanel>
  );
}
