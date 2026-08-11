import { tool } from "ai";
import { z } from "zod";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export function createWebSearchTool() {
  const webSearch = tool({
    description:
      "Search the web for up-to-date information — use this when you don't already know the exact " +
      "URL to fetch (that's what webFetch is for). Good for current events, documentation you don't " +
      "have memorized, or verifying a fact. Backed by Tavily, a real search API — results are live, " +
      "not a guess.",
    inputSchema: z.object({
      query: z.string(),
      maxResults: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) return { error: "TAVILY_API_KEY is not configured on the server" };

        const res = await fetch(TAVILY_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: "basic",
            include_answer: true,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { error: body?.detail?.error ?? `Tavily search failed (${res.status})` };
        }

        const data = (await res.json()) as { answer?: string; results: TavilyResult[] };
        return {
          answer: data.answer,
          results: data.results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          })),
        };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { webSearch };
}
