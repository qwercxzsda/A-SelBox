import { createContext } from "react";
import type { WorkspaceWriteOptions } from "./workspace-navigation";
import type { createWorkspaceStore } from "./workspace-storage";

export type WorkspaceStore = Omit<ReturnType<typeof createWorkspaceStore>, "write"> & {
  write(name: string, value: unknown, options?: WorkspaceWriteOptions): void;
};

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);
export const WorkspaceNavigationRevisionContext = createContext(0);
