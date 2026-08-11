export type ModelProvider = "ollama" | "openrouter" | "aihubmix" | "requesty";

export type ModelOption = {
  id: string; // unique app-wide key — used in the picker, localStorage, and route lookups
  providerModelId: string; // the actual model slug sent to the provider's API
  label: string;
  vendor: string;
  description: string;
  provider: ModelProvider;
};

// Local models run via Ollama (localhost:11434) — zero API calls, zero cost.
// The unified chat always has tools available (filesystem, shell, app-building via writeFile),
// so every listed model needs reliable tool/function-calling support — reasoning-only models
// like deepseek-r1 don't reliably emit tool calls and are intentionally excluded.
// Ordered by measured tool-call reliability against this app's actual tool set: gpt-oss-agent
// and gpt-oss:20b called tools correctly 3/3 in testing; qwen3-coder:30b, despite its marketing,
// only did 1/4 and otherwise leaked its native `<function=...>` syntax as plain text.
export const LOCAL_MODELS: ModelOption[] = [
  {
    id: "gpt-oss-agent:latest",
    providerModelId: "gpt-oss-agent:latest",
    label: "GPT-OSS Agent 13B",
    vendor: "OpenAI (open-weight)",
    description: "OpenAI's open-weight model, tuned for agentic tool use — most reliable locally",
    provider: "ollama",
  },
  {
    id: "gpt-oss:20b",
    providerModelId: "gpt-oss:20b",
    label: "GPT-OSS 20B",
    vendor: "OpenAI (open-weight)",
    description: "General-purpose, reliable tool calling",
    provider: "ollama",
  },
  {
    id: "devstral:24b",
    providerModelId: "devstral:24b",
    label: "Devstral 24B",
    vendor: "Mistral",
    description: "Built for autonomous coding agents (SWE-bench class)",
    provider: "ollama",
  },
  {
    id: "qwen3:30b",
    providerModelId: "qwen3:30b",
    label: "Qwen3 30B",
    vendor: "Alibaba",
    description: "Large general-purpose assistant with tool support",
    provider: "ollama",
  },
  {
    id: "glm-4.7-flash",
    providerModelId: "glm-4.7-flash",
    label: "GLM-4.7 Flash",
    vendor: "Zhipu",
    description: "Fast, agentic-capable general model",
    provider: "ollama",
  },
  {
    id: "qwen3-coder:30b",
    providerModelId: "qwen3-coder:30b",
    label: "Qwen3 Coder 30B",
    vendor: "Alibaba",
    description: "Marketed for agentic coding, but flaky tool calling via Ollama in testing",
    provider: "ollama",
  },
];

// Cloud fallback models — only shown in the picker when their provider's API key is configured
// server-side (see /api/providers). Each of these three is the same category of product (an
// OpenAI-compatible multi-model gateway), kept deliberately to one representative model per
// provider rather than a full catalog, since maintaining three overlapping model lists in sync
// isn't worth it — swap `providerModelId` for any other slug the provider supports.
export const CLOUD_MODELS: ModelOption[] = [
  {
    id: "openrouter:gpt-4o-mini",
    providerModelId: "openai/gpt-4o-mini",
    label: "GPT-4o mini (OpenRouter)",
    vendor: "OpenRouter",
    description: "Cloud fallback — leaves the machine, routed via OpenRouter",
    provider: "openrouter",
  },
  {
    id: "aihubmix:gpt-4o-mini",
    providerModelId: "gpt-4o-mini",
    label: "GPT-4o mini (AIHubMix)",
    vendor: "AIHubMix",
    description: "Cloud fallback — leaves the machine, routed via AIHubMix",
    provider: "aihubmix",
  },
  {
    id: "requesty:gpt-4o-mini",
    providerModelId: "openai/gpt-4o-mini",
    label: "GPT-4o mini (Requesty)",
    vendor: "Requesty",
    description: "Cloud fallback — leaves the machine, routed via Requesty",
    provider: "requesty",
  },
];

export const MODELS: ModelOption[] = [...LOCAL_MODELS, ...CLOUD_MODELS];

export const DEFAULT_MODEL = "gpt-oss-agent:latest";

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}

export function findModel(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}
