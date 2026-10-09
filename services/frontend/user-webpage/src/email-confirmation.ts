import type { Session } from "./api/types.ts";

type ConfirmationTokens = Omit<Session, "user">;

/** Auth sends an implicit signup session in the URL fragment after email confirmation. */
export function readEmailConfirmation(hash: string): ConfirmationTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has("access_token") && !params.has("error")) return null;
  if (params.has("error")) {
    throw new Error(
      "This confirmation link is invalid or has expired. Try signing in or creating your account again.",
    );
  }
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in"));
  const expiresAt = params.has("expires_at") ? Number(params.get("expires_at")) : undefined;
  if (
    params.get("type") !== "signup" ||
    params.get("token_type") !== "bearer" ||
    !accessToken?.trim() ||
    !refreshToken?.trim() ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= 0))
  ) {
    throw new Error(
      "This confirmation link could not be verified. Please sign in with your email and password.",
    );
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: expiresIn,
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
}

/** Remove tokens and error payloads before any application requests or rendering. */
export function takeEmailConfirmation(): ConfirmationTokens | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!params.has("access_token") && !params.has("error")) return null;
  const hash = window.location.hash;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return readEmailConfirmation(hash);
}
