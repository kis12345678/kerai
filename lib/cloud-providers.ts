import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type CloudProviderId = "openrouter" | "aihubmix" | "requesty";

const SITE_HEADERS = {
  "HTTP-Referer": "http://localhost:3000",
  "X-Title": "Kerai AI",
};

function makeProvider(id: CloudProviderId, baseURL: string, envVar: string, extraHeaders?: Record<string, string>) {
  const apiKey = process.env[envVar];
  if (!apiKey) return null;
  return createOpenAICompatible({
    name: id,
    baseURL,
    apiKey,
    headers: extraHeaders,
  });
}

export function isCloudProviderConfigured(id: CloudProviderId): boolean {
  const envVar =
    id === "openrouter" ? "OPENROUTER_API_KEY" : id === "aihubmix" ? "AIHUBMIX_API_KEY" : "REQUESTY_API_KEY";
  return Boolean(process.env[envVar]);
}

// Providers are constructed lazily per-request (not module-scoped singletons) since they read
// process.env directly — keeps this simple and avoids stale state across env reloads in dev.
export function getCloudProvider(id: CloudProviderId) {
  switch (id) {
    case "openrouter":
      return makeProvider("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", SITE_HEADERS);
    case "aihubmix":
      return makeProvider("aihubmix", "https://aihubmix.com/v1", "AIHUBMIX_API_KEY");
    case "requesty":
      return makeProvider("requesty", "https://router.requesty.ai/v1", "REQUESTY_API_KEY", SITE_HEADERS);
  }
}
