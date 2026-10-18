import { useEffect, useRef, useState } from "react";
import { Alert, Button, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";

export function PasswordRecoveryPanel({
  email,
  pending,
  error,
  onSubmit,
  onRequestLink,
  onCancel,
}: {
  email: string | undefined;
  pending: boolean;
  error: string | null;
  onSubmit: (password: string) => Promise<void>;
  onRequestLink: () => void;
  onCancel: () => void;
}) {
  // Password fields intentionally remain in component memory, never browser storage.
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="login-shell">
      <Paper component="section" p="xl" shadow="md" withBorder w="100%" maw={480}>
        <Stack gap="md">
          <Title ref={heading} tabIndex={-1} order={2} size="h3">
            Choose a new password
          </Title>
          <Text size="sm" c="dimmed">
            {email
              ? `Resetting the password for ${email}.`
              : "Your recovery link has been verified."}
          </Text>
          {error || validation ? (
            <Alert color="red" role="alert">
              {validation ?? error}
            </Alert>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              if (password.length < 8) {
                setValidation("Use at least 8 characters.");
                return;
              }
              if (password !== confirmation) {
                setValidation("The passwords do not match.");
                return;
              }
              setValidation(null);
              void onSubmit(password);
            }}
          >
            <Stack gap="md">
              <PasswordInput
                label="New password"
                name="new-password"
                autoComplete="new-password"
                minLength={8}
                description="Use at least 8 characters."
                required
                disabled={pending}
                value={password}
                onChange={(event) => {
                  setPassword(event.currentTarget.value);
                  setValidation(null);
                }}
              />
              <PasswordInput
                label="Confirm new password"
                name="confirm-password"
                autoComplete="new-password"
                minLength={8}
                required
                disabled={pending}
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.currentTarget.value);
                  setValidation(null);
                }}
              />
              <Button type="submit" loading={pending}>
                {pending ? "Updating password…" : "Update password"}
              </Button>
            </Stack>
          </form>
          <Text size="xs" c="dimmed">
            Your password changes only when you choose Update password. Reloading clears these
            fields.
          </Text>
          <Button variant="subtle" disabled={pending} onClick={onRequestLink}>
            Request a new recovery link
          </Button>
          <Button variant="subtle" disabled={pending} onClick={onCancel}>
            Cancel and return to sign in
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
