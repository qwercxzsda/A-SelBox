import type { SubmitEvent } from "react";
import { Alert, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";

interface LoginPanelProps {
  email: string;
  errorMessage: string | null;
  isSigningIn: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  password: string;
}

export function LoginPanel({
  email,
  errorMessage,
  isSigningIn,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  password,
}: LoginPanelProps) {
  return (
    <div className="login-shell">
      <Paper component="section" p="xl" shadow="md" withBorder w="100%" maw={480}>
        <Stack gap="md">
          <div>
            <p className="eyebrow">Your company workspace</p>
            <Title order={2} size="h3" mb="xs">
              Sign in to Company Finance
            </Title>
            <Text c="dimmed" size="sm">
              View your company’s transactions, marketplace costs, and current fees.
            </Text>
          </div>
          {errorMessage ? (
            <Alert color="red" role="alert">
              {errorMessage}
            </Alert>
          ) : null}
          <form onSubmit={onSubmit}>
            <Stack gap="md">
              <TextInput
                autoComplete="username"
                label="Email"
                onChange={(event) => {
                  onEmailChange(event.target.value);
                }}
                required
                type="email"
                value={email}
              />
              <PasswordInput
                autoComplete="current-password"
                label="Password"
                onChange={(event) => {
                  onPasswordChange(event.target.value);
                }}
                required
                value={password}
              />
              <Button loading={isSigningIn} type="submit">
                {isSigningIn ? "Signing in…" : "Sign in"}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </div>
  );
}
