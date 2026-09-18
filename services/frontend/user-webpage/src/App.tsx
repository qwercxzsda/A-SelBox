import { LoginPanel } from "./LoginPanel";
import { useEffect, useState } from "react";
import { Button } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { FinanceWorkspace, type WorkspaceProps } from "./FinanceWorkspace";
import { createQueryClient } from "./query-client";
import { companyLabel } from "./view-model";
import { useAuth } from "./use-auth";
import "./App.css";

function AuthenticatedWorkspace(props: WorkspaceProps) {
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <FinanceWorkspace {...props} />
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
  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">A-SelBox · company workspace</p>
            <h1>Company Finance</h1>
          </div>
          {session ? (
            <div className="session-panel">
              <span className="session-identity">
                <span>
                  {account?.access_role === "operator"
                    ? "Operator"
                    : companyLabel(account?.company_id ?? null, companyNames)}
                </span>
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
