import { LoginPanel } from "./LoginPanel";
import { SessionRestorePanel } from "./SessionRestorePanel";
import { lazy, Suspense, useEffect } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { companyLabel } from "./view-model";
import { useAuth } from "./use-auth";
import "./App.css";

const AuthenticatedWorkspace = lazy(async () => {
  try {
    return await import("./AuthenticatedWorkspace");
  } catch {
    return { default: WorkspaceLoadError };
  }
});

function WorkspaceLoadError() {
  return (
    <Alert color="red" role="alert">
      <Stack gap="sm" align="start">
        <Text>Could not load the workspace. Reload to try again.</Text>
        <Button
          variant="light"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload workspace
        </Button>
      </Stack>
    </Alert>
  );
}

function App() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    identity,
    isSigningIn,
    isSigningOut,
    isRestoring,
    restoreError,
    authError,
    handleSignIn,
    handleSignOut,
    refreshIdentity,
    retryRestore,
    discardStoredSession,
  } = useAuth();
  const session = identity?.session;
  const account = identity?.account;
  const companyNames = new Map(identity?.companies.map((company) => [company.id, company.name]));
  const accountLabel = !account
    ? null
    : account.access_role === "operator"
      ? "Administrator"
      : companyLabel(account.company_id, companyNames);
  useEffect(() => {
    document.title = accountLabel ? `${accountLabel} · A-SelBox` : "A-SelBox";
  }, [accountLabel]);
  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <p className="app-brand">A-SelBox</p>
          {session ? (
            <div className="session-panel">
              <span className="session-identity">
                <span>{accountLabel}</span>
                <strong>{session.user.email ?? email}</strong>
              </span>
              <Button
                variant="default"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {isSigningOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          ) : null}
        </header>

        {isRestoring || restoreError ? (
          <SessionRestorePanel
            pending={isRestoring}
            error={restoreError}
            onRetry={() => void retryRestore()}
            onSignIn={discardStoredSession}
          />
        ) : !identity ? (
          <LoginPanel
            email={email}
            errorMessage={authError}
            isSigningIn={isSigningIn || isSigningOut}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={(event) => void handleSignIn(event)}
            password={password}
          />
        ) : (
          <Suspense fallback={<Text role="status">Loading workspace…</Text>}>
            <AuthenticatedWorkspace
              key={`${identity.account.user_id}:${identity.account.access_role}:${identity.account.company_id ?? ""}`}
              identity={identity}
              onRefreshIdentity={refreshIdentity}
            />
          </Suspense>
        )}
      </div>
    </main>
  );
}

export default App;
