import { createContext, useContext } from "react";
import type { Company, CreateCompanyResult, DeleteCompanyResult } from "./api";

interface CompanyDirectory {
  companies: Company[];
  canManage: boolean;
  isMutating: boolean;
  isCreating: boolean;
  deletingId: string | null;
  create: (name: string) => Promise<CreateCompanyResult>;
  remove: (companyId: string) => Promise<DeleteCompanyResult>;
}

export const CompanyDirectoryContext = createContext<CompanyDirectory | null>(null);

export function useCompanyDirectory(): CompanyDirectory {
  const directory = useContext(CompanyDirectoryContext);
  if (!directory) throw new Error("Company controls require an authenticated workspace.");
  return directory;
}
