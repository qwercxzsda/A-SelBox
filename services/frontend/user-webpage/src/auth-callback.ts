import type { Session } from "./api/types.ts";

export interface AuthCallback {
  kind: "signup" | "recovery";
  tokens: Omit<Session, "user">;
}

export class AuthCallbackError extends Error {
  readonly recovery: boolean;
  constructor(message: string, recovery: boolean) {
    super(message);
    this.recovery = recovery;
  }
}

function hasAuthCallback(params: URLSearchParams): boolean {
  return (
    [
      "access_token",
      "refresh_token",
      "token_type",
      "error",
      "error_code",
      "error_description",
    ].some((key) => params.has(key)) || ["signup", "recovery"].includes(params.get("type") ?? "")
  );
}

/** Only Auth verifies identity; callback claims about users or roles are ignored. */
export function readAuthCallback(hash: string): AuthCallback | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!hasAuthCallback(params)) return null;
  const recovery = params.get("type") === "recovery";
  if (["error", "error_code", "error_description"].some((key) => params.has(key)))
    throw new AuthCallbackError(
      "This account link is invalid or has expired. Request a new password recovery link or sign in.",
      recovery,
    );
  const kind = params.get("type");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in"));
  const expiresAt = params.has("expires_at") ? Number(params.get("expires_at")) : undefined;
  if (
    (kind !== "signup" && kind !== "recovery") ||
    ["type", "access_token", "refresh_token", "token_type", "expires_in", "expires_at"].some(
      (key) => params.getAll(key).length > 1,
    ) ||
    params.get("token_type") !== "bearer" ||
    !accessToken?.trim() ||
    !refreshToken?.trim() ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= 0))
  )
    throw new AuthCallbackError(
      "This account link could not be verified. Request a new password recovery link or sign in.",
      recovery,
    );
  return {
    kind,
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn,
      ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    },
  };
}

/** Called during module bootstrap, before React renders or any authenticated requests run. */
export function takeAuthCallback(): AuthCallback | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hasAuthCallback(new URLSearchParams(hash.replace(/^#/, "")))) return null;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return readAuthCallback(hash);
}
