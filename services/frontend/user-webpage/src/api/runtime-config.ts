import type { ApiClientConfig } from "./client-config.ts";
import { isJsonObject } from "./validation.ts";

export { validateApiConfig, type ApiClientConfig } from "./client-config.ts";

export function readBuildConfig(environment: unknown = import.meta.env): ApiClientConfig {
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
