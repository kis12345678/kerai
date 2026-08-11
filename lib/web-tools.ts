import { tool } from "ai";
import { z } from "zod";

const MAX_FETCH_BYTES = 150_000;
const FETCH_TIMEOUT_MS = 15_000;

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function createWebTools() {
  const webFetch = tool({
    description:
      "Fetch a URL from the internet and return its text content — useful for reading docs, API " +
      "references, checking error messages, or looking up up-to-date information. HTML is stripped " +
      "down to readable text.",
    inputSchema: z.object({
      url: z.string().describe("Full URL to fetch, including https://"),
    }),
    execute: async ({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: "Only http:// and https:// URLs are supported" };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "OmniAI-Agent/1.0" },
          });
          const contentType = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          const isHtml = contentType.includes("html");
          const content = (isHtml ? htmlToText(raw) : raw).slice(0, MAX_FETCH_BYTES);
          return {
            status: res.status,
            contentType,
            content,
            truncated: raw.length > MAX_FETCH_BYTES,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { webFetch };
}
