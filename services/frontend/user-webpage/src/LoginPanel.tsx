import type { SubmitEvent } from "react";
import { Alert, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";

interface LoginPanelProps {
  mode: "sign-in" | "sign-up";
  email: string;
  errorMessage: string | null;
  statusMessage: string | null;
  isSubmitting: boolean;
  onModeChange: (mode: "sign-in" | "sign-up") => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  password: string;
}

export function LoginPanel({
  mode,
  email,
  errorMessage,
  statusMessage,
  isSubmitting,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  password,
}: LoginPanelProps) {
  const signingUp = mode === "sign-up";
  const action = signingUp ? "Create account" : "Sign in";
  return (
    <div className="login-shell">
      <Paper component="section" p="xl" shadow="md" withBorder w="100%" maw={480}>
        <Stack gap="md">
          <div>
            <Title order={2} size="h3" mb="xs">
              {action}
            </Title>
            <Text c="dimmed" size="sm">
              {signingUp
                ? "Create an account with your email. An administrator can then assign you to a company."
                : "View transactions, payouts, fee settings, and inventory."}
            </Text>
          </div>
          {errorMessage ? (
            <Alert color="red" role="alert">
              {errorMessage}
            </Alert>
          ) : null}
          {statusMessage ? (
            <Alert color="cyan" role="status" title="Check your email">
              {statusMessage}
            </Alert>
          ) : null}
          <form onSubmit={onSubmit}>
            <Stack gap="md">
              <TextInput
                disabled={isSubmitting}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                label="Email"
                name="email"
                onChange={(event) => {
                  onEmailChange(event.target.value);
                }}
                required
                type="email"
                value={email}
              />
              <PasswordInput
                autoComplete={signingUp ? "new-password" : "current-password"}
                description={signingUp ? "Use at least 8 characters." : undefined}
                disabled={isSubmitting}
                minLength={signingUp ? 8 : undefined}
                label="Password"
                name="password"
                onChange={(event) => {
                  onPasswordChange(event.target.value);
                }}
                required
                value={password}
              />
              <Button loading={isSubmitting} type="submit">
                {isSubmitting ? (signingUp ? "Creating account…" : "Signing in…") : action}
              </Button>
            </Stack>
          </form>
          <Button
            disabled={isSubmitting}
            onClick={() => {
              onModeChange(signingUp ? "sign-in" : "sign-up");
            }}
            type="button"
            variant="subtle"
          >
            {signingUp ? "Already have an account? Sign in" : "New to A-SelBox? Create an account"}
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
