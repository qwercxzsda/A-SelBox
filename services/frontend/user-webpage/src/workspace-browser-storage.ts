import { readRuntimeConfig } from "./api/runtime-config";
import {
  clearWorkspaceStorage,
  workspaceStoragePrefix,
  type WorkspaceStorage,
} from "./workspace-storage";

export function browserWorkspaceStorage(): { storage: WorkspaceStorage | null; prefix: string } {
  try {
    const { supabaseUrl } = readRuntimeConfig(import.meta.env, window.location.origin);
    return { storage: window.sessionStorage, prefix: workspaceStoragePrefix(supabaseUrl) };
  } catch {
    return { storage: null, prefix: "" };
  }
}

export function clearBrowserWorkspace(): void {
  const { storage, prefix } = browserWorkspaceStorage();
  clearWorkspaceStorage(storage, prefix);
}
