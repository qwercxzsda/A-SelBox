import { ApiError, type ApiTransport } from "./transport.ts";
import type { Session, SessionUser } from "./types.ts";
import {
  isJsonObject,
  requiredJsonString,
  optionalJsonString,
  requiredJsonNumber,
  optionalJsonNumber,
} from "./validation.ts";

function parseSession(value: unknown, operation: string): Session {
  if (!isJsonObject(value) || !isJsonObject(value.user)) {
    throw new Error(`${operation} returned an invalid session`);
  }
  return {
    access_token: requiredJsonString(value, "access_token"),
    token_type: requiredJsonString(value, "token_type"),
    expires_in: requiredJsonNumber(value, "expires_in"),
    expires_at: optionalJsonNumber(value, "expires_at"),
    refresh_token: requiredJsonString(value, "refresh_token"),
    user: {
      id: requiredJsonString(value.user, "id"),
      email: optionalJsonString(value.user, "email"),
    },
  };
}

export function createAuthApi({
  request,
  requestJson,
  authenticatedHeaders,
  publishableKey,
}: ApiTransport) {
  async function requestSession(
    grantType: "password" | "refresh_token",
    credentials: Record<string, string>,
    operation: string,
  ): Promise<Session> {
    const value = await requestJson(
      `/auth/v1/token?grant_type=${grantType}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: publishableKey },
        body: JSON.stringify(credentials),
      },
      operation,
    );
    return parseSession(value, operation);
  }

  return {
    signIn(email: string, password: string): Promise<Session> {
      return requestSession("password", { email, password }, "Sign in");
    },

    refreshSession(refreshToken: string): Promise<Session> {
      if (refreshToken.trim().length === 0) throw new Error("A refresh token is required");
      return requestSession("refresh_token", { refresh_token: refreshToken }, "Session refresh");
    },

    async fetchSessionUser(accessToken: string): Promise<SessionUser> {
      const operation = "Session verification";
      const value = await requestJson(
        "/auth/v1/user",
        { headers: authenticatedHeaders(accessToken) },
        operation,
      );
      if (!isJsonObject(value)) throw new Error("Session verification returned an invalid user");
      return { id: requiredJsonString(value, "id"), email: optionalJsonString(value, "email") };
    },

    async signOut(accessToken: string): Promise<void> {
      const response = await request(
        "/auth/v1/logout?scope=local",
        { method: "POST", headers: authenticatedHeaders(accessToken) },
        "Sign out",
      );
      if (!response.ok) throw new ApiError("Sign out", response.status);
    },
  };
}
