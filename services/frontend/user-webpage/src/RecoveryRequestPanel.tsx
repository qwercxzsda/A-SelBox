import { useEffect, useRef, type SubmitEvent } from "react";
import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";

export function RecoveryRequestPanel({
  email,
  onEmailChange,
  onSubmit,
  onSignIn,
  pending,
  error,
  status,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onSignIn: () => void;
  pending: boolean;
  error: string | null;
  status: string | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="login-shell">
      <Paper component="section" p="xl" shadow="md" withBorder w="100%" maw={480}>
        <Stack gap="md">
          <Title ref={heading} tabIndex={-1} order={2} size="h3">
            Reset your password
          </Title>
          <Text size="sm" c="dimmed">
            Enter your account email to request a password recovery link.
          </Text>
          {error ? (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          ) : null}
          {status ? (
            <Alert color="cyan" role="status" title="Check your email">
              {status}
            </Alert>
          ) : null}
          <form onSubmit={onSubmit}>
            <Stack gap="md">
              <TextInput
                label="Email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                disabled={pending}
                onChange={(event) => {
                  onEmailChange(event.currentTarget.value);
                }}
              />
              <Button type="submit" loading={pending}>
                {pending ? "Requesting link…" : "Send recovery link"}
              </Button>
            </Stack>
          </form>
          <Button variant="subtle" disabled={pending} onClick={onSignIn}>
            Back to sign in
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
