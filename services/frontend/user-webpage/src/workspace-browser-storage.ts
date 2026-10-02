import { readBuildConfig } from "./api/runtime-config";
import { validateApiConfig } from "./api/client-config";
import {
  clearWorkspaceStorage,
  workspaceStoragePrefix,
  type WorkspaceStorage,
} from "./workspace-storage";

export function browserWorkspaceStorage(): { storage: WorkspaceStorage | null; prefix: string } {
  try {
    const { supabaseUrl } = validateApiConfig(readBuildConfig(import.meta.env));
    return { storage: window.sessionStorage, prefix: workspaceStoragePrefix(supabaseUrl) };
  } catch {
    return { storage: null, prefix: "" };
  }
}

export function clearBrowserWorkspace(): void {
  const { storage, prefix } = browserWorkspaceStorage();
  clearWorkspaceStorage(storage, prefix);
}
