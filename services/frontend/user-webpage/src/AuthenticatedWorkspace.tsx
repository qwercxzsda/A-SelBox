import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Identity, IdentityRefreshOptions } from "./auth-session";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { createQueryClient } from "./query-client";
import { useWorkspaceRefresh } from "./use-workspace-refresh";
import { WorkspacePreferences } from "./WorkspacePreferences";

interface AuthenticatedProps {
  identity: Identity;
  onRefreshIdentity: (options?: IdentityRefreshOptions) => Promise<boolean>;
}

function WorkspaceContent({ identity, onRefreshIdentity }: AuthenticatedProps) {
  const { refresh, isUpdating, updateError } = useWorkspaceRefresh(identity, onRefreshIdentity);
  return (
    <FinanceWorkspace
      identity={identity}
      onRetry={refresh}
      isUpdating={isUpdating}
      updateError={updateError}
    />
  );
}

export default function AuthenticatedWorkspace(props: AuthenticatedProps) {
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <WorkspacePreferences identity={props.identity}>
        <WorkspaceContent {...props} />
      </WorkspacePreferences>
    </QueryClientProvider>
  );
}
