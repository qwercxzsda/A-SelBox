import { useMemo, useRef, useState, type ReactNode } from "react";
import { createCompany, deleteCompany, type Company } from "./api";
import type { Identity } from "./auth-session";
import { CompanyDirectoryContext } from "./company-directory-context";
import { useMountedRef } from "./use-mounted-ref";

interface CompanyCatalog {
  server: Company[];
  added: Company[];
  removed: string[];
}

type CompanyMutation = { kind: "create" } | { kind: "delete"; id: string };

/** Confirmed changes are visible before the next lightweight catalog refresh. */
export function CompanyDirectoryProvider({
  identity,
  children,
}: {
  identity: Identity;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState<CompanyCatalog>(() => ({
    server: identity.companies,
    added: [],
    removed: [],
  }));
  if (catalog.server !== identity.companies) {
    // Confirmed entries belong to the server catalog, including later renames or removals.
    const confirmed = new Set(identity.companies.map(({ id }) => id));
    setCatalog({
      server: identity.companies,
      added: catalog.added.filter(({ id }) => !confirmed.has(id)),
      // A refresh started before deletion may still include the company. Keep hiding it
      // until a server catalog acknowledges the removal.
      removed: catalog.removed.filter((id) => confirmed.has(id)),
    });
  }
  const [mutation, setMutation] = useState<CompanyMutation | null>(null);
  const mounted = useMountedRef();
  const pending = useRef(false);
  const canManage = identity.account.access_role === "administrator";
  const companies = useMemo(() => {
    const merged = new Map(catalog.added.map((company) => [company.id, company]));
    // Fresh server names take precedence over the in-memory creation result.
    for (const company of identity.companies) merged.set(company.id, company);
    for (const id of catalog.removed) merged.delete(id);
    return [...merged.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  }, [catalog.added, catalog.removed, identity.companies]);

  async function runMutation<Result>(
    next: CompanyMutation,
    request: () => Promise<Result>,
    apply: (current: CompanyCatalog, result: Result) => CompanyCatalog,
  ): Promise<Result> {
    if (!canManage)
      throw new Error(
        `Only administrators can ${next.kind === "create" ? "add" : "delete"} companies.`,
      );
    if (pending.current) throw new Error("A company change is in progress. Please wait.");
    pending.current = true;
    setMutation(next);
    try {
      const result = await request();
      if (mounted.current) setCatalog((current) => apply(current, result));
      return result;
    } finally {
      pending.current = false;
      if (mounted.current) setMutation(null);
    }
  }

  function create(name: string) {
    return runMutation(
      { kind: "create" },
      () => createCompany(identity.session.access_token, name),
      (current, result) => ({
        ...current,
        removed: current.removed.filter((id) => id !== result.id),
        added: [
          ...current.added.filter(({ id }) => id !== result.id),
          ...(current.server.some(({ id }) => id === result.id)
            ? []
            : [{ id: result.id, name: result.name }]),
        ],
      }),
    );
  }

  function remove(companyId: string) {
    return runMutation(
      { kind: "delete", id: companyId },
      () => deleteCompany(identity.session.access_token, companyId),
      (current) => ({
        ...current,
        added: current.added.filter(({ id }) => id !== companyId),
        removed: [...new Set([...current.removed, companyId])],
      }),
    );
  }

  return (
    <CompanyDirectoryContext
      value={{
        companies,
        canManage,
        isMutating: mutation !== null,
        isCreating: mutation?.kind === "create",
        deletingId: mutation?.kind === "delete" ? mutation.id : null,
        create,
        remove,
      }}
    >
      {children}
    </CompanyDirectoryContext>
  );
}
