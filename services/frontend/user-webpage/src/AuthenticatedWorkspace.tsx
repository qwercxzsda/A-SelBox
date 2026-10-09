import { useEffect, useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Alert, Badge, Paper, Stack, Text, Title } from "@mantine/core";
import type { Identity, IdentityRefreshOptions } from "./auth-session";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { createQueryClient } from "./query-client";
import { useWorkspaceRefresh } from "./use-workspace-refresh";
import { WorkspacePreferences } from "./WorkspacePreferences";
import { CompanyDirectoryProvider } from "./CompanyDirectoryProvider";
import { useCompanyDirectory } from "./company-directory-context";

interface AuthenticatedProps {
  identity: Identity;
  onRefreshIdentity: (options?: IdentityRefreshOptions) => Promise<boolean>;
}

function WorkspaceContent({ identity, onRefreshIdentity }: AuthenticatedProps) {
  const { companies } = useCompanyDirectory();
  const visibleIdentity = useMemo(() => ({ ...identity, companies }), [identity, companies]);
  const { refresh, isUpdating, updateError } = useWorkspaceRefresh(identity, onRefreshIdentity);
  if (identity.account.access_role === "unassigned") {
    return (
      <Paper withBorder p="xl" maw={640} mx="auto">
        <Stack gap="md">
          <Badge variant="light" color="gray" w="fit-content">
            Unassigned
          </Badge>
          <Title order={2}>Awaiting company access</Title>
          <Text>Your account is ready. Ask an administrator to assign you to your company.</Text>
          <Text size="sm" c="dimmed">
            This page checks for access changes automatically. Your workspace will appear here once
            membership is granted.
          </Text>
          {updateError ? (
            <Alert color="red" role="alert">
              {updateError} Updates retry automatically.
            </Alert>
          ) : null}
        </Stack>
      </Paper>
    );
  }
  return (
    <FinanceWorkspace
      identity={visibleIdentity}
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
        <CompanyDirectoryProvider identity={props.identity}>
          <WorkspaceContent {...props} />
        </CompanyDirectoryProvider>
      </WorkspacePreferences>
    </QueryClientProvider>
  );
}
