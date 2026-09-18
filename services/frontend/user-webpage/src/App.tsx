import { LoginPanel } from "./LoginPanel";
import { useEffect, useState } from "react";
import { Button } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { createQueryClient } from "./query-client";
import { companyLabel } from "./view-model";
import { useAuth } from "./use-auth";
import { useWorkspaceRefresh } from "./use-workspace-refresh";
import type { Identity } from "./use-auth";
import "./App.css";

interface AuthenticatedProps {
  identity: Identity;
  onRefreshIdentity: () => Promise<boolean>;
}

function WorkspaceContent({ identity, onRefreshIdentity }: AuthenticatedProps) {
  const { refresh, isUpdating, updateError } = useWorkspaceRefresh(onRefreshIdentity);
  return (
    <FinanceWorkspace
      identity={identity}
      onRetry={refresh}
      isUpdating={isUpdating}
      updateError={updateError}
    />
  );
}

function AuthenticatedWorkspace(props: AuthenticatedProps) {
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <WorkspaceContent {...props} />
    </QueryClientProvider>
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
    authError,
    handleSignIn,
    handleSignOut,
    refreshIdentity,
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

        {!identity ? (
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
          <AuthenticatedWorkspace
            key={`${identity.account.user_id}:${identity.account.access_role}:${identity.account.company_id ?? ""}`}
            identity={identity}
            onRefreshIdentity={refreshIdentity}
          />
        )}
      </div>
    </main>
  );
}

export default App;
