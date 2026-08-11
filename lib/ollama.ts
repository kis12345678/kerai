import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";

export const ollama = createOpenAICompatible({
  baseURL: OLLAMA_BASE_URL,
  name: "ollama",
});
