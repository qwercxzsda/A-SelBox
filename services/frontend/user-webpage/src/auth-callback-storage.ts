import { isJsonObject } from "./api/validation.ts";
import { readAuthCallback, takeAuthCallback, type AuthCallback } from "./auth-callback.ts";

type RecoveryMode = { stage: "request" } | { stage: "password"; userId: string };
interface AuthCallbackState {
  pending: AuthCallback | null;
  recovery: RecoveryMode | null;
}
const emptyState = (): AuthCallbackState => ({ pending: null, recovery: null });

function decodePending(value: unknown): AuthCallback | null {
  if (!isJsonObject(value) || !isJsonObject(value.tokens)) return null;
  const tokens = value.tokens;
  if (
    (value.kind !== "signup" && value.kind !== "recovery") ||
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string" ||
    typeof tokens.token_type !== "string" ||
    typeof tokens.expires_in !== "number" ||
    (tokens.expires_at !== undefined && typeof tokens.expires_at !== "number")
  )
    return null;
  try {
    return readAuthCallback(
      new URLSearchParams({
        type: value.kind,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_in: String(tokens.expires_in),
        ...(tokens.expires_at === undefined ? {} : { expires_at: String(tokens.expires_at) }),
      }).toString(),
    );
  } catch {
    return null;
  }
}

function decodeRecoveryMode(value: unknown): RecoveryMode | null {
  if (!isJsonObject(value)) return null;
  if (value.stage === "request") return { stage: "request" };
  if (value.stage === "password" && typeof value.userId === "string" && value.userId.trim())
    return { stage: "password", userId: value.userId };
  return null;
}

function decodeState(value: unknown): AuthCallbackState {
  if (!isJsonObject(value)) return emptyState();
  return { pending: decodePending(value.pending), recovery: decodeRecoveryMode(value.recovery) };
}

/** Persist callback tokens/flow only. Password form values are never accepted or stored. */
export function createAuthCallbackStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  key: string,
) {
  let memory = emptyState();
  let memoryOnly = storage === null;
  return {
    read(): AuthCallbackState {
      if (memoryOnly) return memory;
      let raw: string | null | undefined;
      try {
        raw = storage?.getItem(key);
      } catch {
        memoryOnly = true;
        return memory;
      }
      try {
        memory = raw ? decodeState(JSON.parse(raw) as unknown) : emptyState();
      } catch {
        memory = emptyState();
      }
      return memory;
    },
    write(state: AuthCallbackState): void {
      memory = decodeState(state);
      try {
        storage?.setItem(key, JSON.stringify(memory));
      } catch {
        memoryOnly = true;
      }
    },
    clear(): void {
      memory = emptyState();
      try {
        storage?.removeItem(key);
      } catch {
        memoryOnly = true;
      }
    },
  };
}

/** Capture once before rendering; pending verification remains resumable after F5. */
export function bootstrapAuthCallback() {
  let storage: Storage | null = null;
  let origin = "";
  if (typeof window !== "undefined") {
    origin = window.location.origin;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Use memory for restricted browsers. */
    }
  }
  const store = createAuthCallbackStore(storage, `aselbox.auth.callback.v1:${origin}`);
  try {
    const callback = takeAuthCallback();
    if (callback) store.write({ pending: callback, recovery: null });
    return { store, error: null };
  } catch (error) {
    store.clear();
    return { store, error };
  }
}
