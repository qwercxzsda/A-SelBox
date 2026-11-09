import { validateApiConfig, type ApiClientConfig } from "./client-config.ts";
import { isJsonObject } from "./validation.ts";

function readEnvironmentConfig(environment: unknown): ApiClientConfig {
  if (!isJsonObject(environment)) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured");
  }
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim() === "") {
    throw new Error("VITE_SUPABASE_URL must be configured");
  }
  if (typeof publishableKey !== "string" || publishableKey.trim() === "") {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be configured");
  }
  return { supabaseUrl, publishableKey };
}

/** Same-origin is opt-in; all resolved URLs and public keys use the normal validation. */
export function readRuntimeConfig(environment: unknown, browserOrigin: string): ApiClientConfig {
  const config = readEnvironmentConfig(environment);
  return validateApiConfig({
    ...config,
    supabaseUrl: config.supabaseUrl === "same-origin" ? browserOrigin : config.supabaseUrl,
  });
}

export function validateBuildConfig(environment: unknown): void {
  // The deployment origin is unknown at build time. This value validates only;
  // runtime consumers always supply the actual browser origin.
  readRuntimeConfig(environment, "https://same-origin.invalid");
}
