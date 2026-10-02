import { createContext } from "react";
import type { createWorkspaceStore } from "./workspace-storage";

export const WorkspaceContext = createContext<ReturnType<typeof createWorkspaceStore> | null>(null);
