import type { Session } from "./api/types.ts";
import { isJsonObject } from "./api/validation.ts";

type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function sessionStorageKey(supabaseUrl: string): string {
  return `aselbox.auth.session.v1:${supabaseUrl.replace(/\/+$/, "")}`;
}

function decodeSession(value: unknown): Session | null {
  if (!isJsonObject(value) || !isJsonObject(value.user)) return null;
  const { access_token, refresh_token, token_type, expires_in, expires_at, user } = value;
  if (
    typeof access_token !== "string" ||
    !access_token.trim() ||
    typeof refresh_token !== "string" ||
    !refresh_token.trim() ||
    typeof token_type !== "string" ||
    token_type.toLowerCase() !== "bearer" ||
    typeof expires_in !== "number" ||
    !Number.isFinite(expires_in) ||
    expires_in <= 0 ||
    typeof expires_at !== "number" ||
    !Number.isFinite(expires_at) ||
    expires_at <= 0 ||
    typeof user.id !== "string" ||
    !user.id.trim() ||
    (user.email !== undefined && typeof user.email !== "string")
  )
    return null;
  // Whitelist session fields: never restore cached permissions, company data or passwords.
  return {
    access_token,
    refresh_token,
    token_type,
    expires_in,
    expires_at,
    user: { id: user.id, ...(user.email === undefined ? {} : { email: user.email }) },
  };
}

export function createSessionStore(storage: StorageAccess | null, key: string) {
  let memory: Session | null = null;
  let memoryOnly = storage === null;

  function clear(): void {
    memory = null;
    try {
      storage?.removeItem(key);
    } catch {
      // Never resurrect credentials that could not be removed from browser storage.
      memoryOnly = true;
    }
  }
  return {
    clear,
    read(): Session | null {
      if (memoryOnly) return memory;
      let raw: string | null | undefined;
      try {
        raw = storage?.getItem(key);
      } catch {
        memoryOnly = true;
        return memory;
      }
      if (!raw) return (memory = null);
      try {
        memory = decodeSession(JSON.parse(raw) as unknown);
      } catch {
        memory = null;
      }
      if (!memory) clear();
      return memory;
    },
    write(session: Session, nowMs = Date.now()): Session {
      const normalized = decodeSession({
        ...session,
        expires_at: session.expires_at ?? Math.floor(nowMs / 1000) + session.expires_in,
      });
      if (!normalized) throw new Error("The server returned an invalid session");
      memory = normalized;
      try {
        storage?.setItem(key, JSON.stringify(normalized));
        memoryOnly = storage === null;
      } catch {
        // Token rotation must remain usable for a retry even when persistence fails.
        memoryOnly = true;
      }
      return normalized;
    },
  };
}
