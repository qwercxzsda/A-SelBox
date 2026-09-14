import { isJsonObject } from "./validation.ts";

export interface ApiClientConfig {
  supabaseUrl: string;
  publishableKey: string;
}

export function validateApiConfig(config: ApiClientConfig): ApiClientConfig {
  let url: URL;
  try {
    url = new URL(config.supabaseUrl);
  } catch {
    throw new Error("Supabase URL must be a valid HTTP or HTTPS origin");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && localHosts.has(url.hostname))) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/*$/.test(url.pathname)
  ) {
    throw new Error("Supabase URL must be an HTTPS origin or a local development HTTP origin");
  }

  const publishableKey = config.publishableKey.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    // Older local stacks use an anon JWT. Reject secret/service-role keys before
    // constructing any request, including an Auth password request.
    let payload: unknown;
    try {
      const parts = publishableKey.split(".");
      if (parts.length !== 3) throw new Error("Invalid JWT");
      const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as unknown;
    } catch {
      throw new Error("A Supabase publishable key or legacy anon key is required");
    }
    if (!isJsonObject(payload) || payload.role !== "anon") {
      throw new Error("A Supabase publishable key or legacy anon key is required");
    }
  }
  return { supabaseUrl: url.origin, publishableKey };
}
