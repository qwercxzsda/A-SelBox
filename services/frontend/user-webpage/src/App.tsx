import { LoginPanel } from "./LoginPanel";
import { SessionRestorePanel } from "./SessionRestorePanel";
import { lazy, Suspense, useEffect } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { companyLabel } from "./view-model";
import { useAuth } from "./use-auth";
import { RecoveryRequestPanel } from "./RecoveryRequestPanel";
import { PasswordRecoveryPanel } from "./PasswordRecoveryPanel";
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
    authMode,
    changeAuthMode,
    authStatus,
    authStatusTitle,
    recoverySession,
    identity,
    isSubmitting,
    isSigningOut,
    isRestoring,
    restoreError,
    authError,
    handleAuthenticate,
    handleSignOut,
    refreshIdentity,
    retryRestore,
    discardStoredSession,
    handlePasswordUpdate,
    requestNewRecoveryLink,
  } = useAuth();
  const session = identity?.session;
  const account = identity?.account;
  const companyNames = new Map(identity?.companies.map((company) => [company.id, company.name]));
  const accountLabel = !account
    ? null
    : account.access_role === "administrator"
      ? "Administrator"
      : companyLabel(account.company_id, companyNames);
  useEffect(() => {
    if (!accountLabel) document.title = "A-SelBox";
  }, [accountLabel]);
  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <h1 className="app-brand">A-SelBox</h1>
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
        ) : recoverySession ? (
          <PasswordRecoveryPanel
            email={recoverySession.user.email}
            pending={isSubmitting}
            error={authError}
            onSubmit={handlePasswordUpdate}
            onRequestLink={requestNewRecoveryLink}
            onCancel={discardStoredSession}
          />
        ) : !identity && authMode === "recover" ? (
          <RecoveryRequestPanel
            email={email}
            onEmailChange={setEmail}
            onSubmit={(event) => void handleAuthenticate(event)}
            onSignIn={() => {
              changeAuthMode("sign-in");
            }}
            pending={isSubmitting}
            error={authError}
            status={authStatus}
          />
        ) : !identity ? (
          <LoginPanel
            mode={authMode === "sign-up" ? "sign-up" : "sign-in"}
            email={email}
            errorMessage={authError}
            statusMessage={authStatus}
            statusTitle={authStatusTitle}
            isSubmitting={isSubmitting || isSigningOut}
            onModeChange={changeAuthMode}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={(event) => void handleAuthenticate(event)}
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
