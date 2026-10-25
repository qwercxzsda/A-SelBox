import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Alert, Button, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { AuthPanel } from "./AuthPanel";

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
  const [invalidField, setInvalidField] = useState<"password" | "confirmation" | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (error) serverErrorRef.current?.focus();
  }, [error]);
  function submitPassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (password.length < 8) {
      setInvalidField("password");
      passwordInput.current?.focus();
      return;
    }
    if (password !== confirmation) {
      setInvalidField("confirmation");
      confirmationInput.current?.focus();
      return;
    }
    setInvalidField(null);
    void onSubmit(password);
  }
  return (
    <AuthPanel>
      <Title ref={heading} tabIndex={-1} order={2} size="h3">
        Choose a new password
      </Title>
      <Text size="sm" c="dimmed">
        {email ? `Resetting the password for ${email}.` : "Your recovery link has been verified."}
      </Text>
      {error && !invalidField ? (
        <Alert ref={serverErrorRef} tabIndex={-1} color="red" role="alert">
          {error}
        </Alert>
      ) : null}
      <form onSubmit={submitPassword}>
        <Stack gap="md">
          <PasswordInput
            visibilityToggleFocusable
            ref={passwordInput}
            label="New password"
            name="new-password"
            autoComplete="new-password"
            minLength={8}
            description="Use at least 8 characters."
            required
            disabled={pending}
            value={password}
            aria-invalid={invalidField === "password" || undefined}
            error={
              invalidField === "password" ? (
                <span role="alert">Use at least 8 characters.</span>
              ) : undefined
            }
            onChange={(event) => {
              setPassword(event.currentTarget.value);
              setInvalidField(null);
            }}
          />
          <PasswordInput
            visibilityToggleFocusable
            ref={confirmationInput}
            label="Confirm new password"
            name="confirm-password"
            autoComplete="new-password"
            minLength={8}
            required
            disabled={pending}
            value={confirmation}
            aria-invalid={invalidField === "confirmation" || undefined}
            error={
              invalidField === "confirmation" ? (
                <span role="alert">The passwords do not match.</span>
              ) : undefined
            }
            onChange={(event) => {
              setConfirmation(event.currentTarget.value);
              setInvalidField(null);
            }}
          />
          <Button type="submit" loading={pending}>
            {pending ? "Updating password…" : "Update password"}
          </Button>
        </Stack>
      </form>
      <Text size="xs" c="dimmed">
        Your password changes only when you choose Update password. Reloading clears these fields.
      </Text>
      <Button variant="subtle" disabled={pending} onClick={onRequestLink}>
        Request a new recovery link
      </Button>
      <Button variant="subtle" disabled={pending} onClick={onCancel}>
        Cancel and return to sign in
      </Button>
    </AuthPanel>
  );
}
