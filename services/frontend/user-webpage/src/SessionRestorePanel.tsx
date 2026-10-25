import { Alert, Button, Text } from "@mantine/core";
import { AuthPanel } from "./AuthPanel";

export function SessionRestorePanel({
  pending,
  error,
  onRetry,
  onSignIn,
}: {
  pending: boolean;
  error: string | null;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  return (
    <AuthPanel>
      {pending ? <Text role="status">Restoring session…</Text> : null}
      {error ? (
        <>
          <Alert color="red" role="alert">
            {error}
          </Alert>
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
