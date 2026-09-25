import { Alert, Button, Paper, Stack, Text } from "@mantine/core";

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
    <div className="login-shell">
      <Paper component="section" p="xl" shadow="md" withBorder w="100%" maw={480}>
        <Stack gap="md">
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
        </Stack>
      </Paper>
    </div>
  );
}
