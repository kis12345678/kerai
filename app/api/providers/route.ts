import { isCloudProviderConfigured } from "@/lib/cloud-providers";
import { isTavilyConfigured } from "@/lib/web-search";

export async function GET() {
  return Response.json({
    openrouter: isCloudProviderConfigured("openrouter"),
    aihubmix: isCloudProviderConfigured("aihubmix"),
    requesty: isCloudProviderConfigured("requesty"),
    tavily: isTavilyConfigured(),
  });
}
