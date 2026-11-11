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
    throw new Error("A Supabase publishable key is required");
  }
  return { supabaseUrl: url.origin, publishableKey };
}
