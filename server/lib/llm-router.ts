import { GoogleGenAI } from "@google/genai";
import { eventBus } from "./events.js";
import type { LLMProvider, LLMConfig, LLMMessage, LLMResponse } from "@shared/api";

// ── Provider Adapters ──────────────────────────────────────────

interface ProviderAdapter {
  name: LLMProvider;
  generate(messages: LLMMessage[], config: LLMConfig, systemPrompt?: string): Promise<LLMResponse>;
  generateStream(
    messages: LLMMessage[],
    config: LLMConfig,
    onChunk: (chunk: string) => void,
    systemPrompt?: string,
  ): Promise<LLMResponse>;
  isAvailable(): boolean;
}

// ── Gemini Adapter ─────────────────────────────────────────────

class GeminiAdapter implements ProviderAdapter {
  name: LLMProvider = "gemini";
  private client: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async generate(messages: LLMMessage[], config: LLMConfig, systemPrompt?: string): Promise<LLMResponse> {
    if (!this.client) throw new Error("Gemini API key not configured");

    const start = Date.now();
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" as const : m.role as "user" | "model",
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContent({
      model: config.model || "gemini-3.6-flash",
      contents,
      config: systemPrompt ? { systemInstruction: systemPrompt } : undefined,
    });

    return {
      text: response.text ?? "",
      provider: "gemini",
      model: config.model || "gemini-3.6-flash",
      latencyMs: Date.now() - start,
    };
  }

  async generateStream(
    messages: LLMMessage[],
    config: LLMConfig,
    onChunk: (chunk: string) => void,
    systemPrompt?: string,
  ): Promise<LLMResponse> {
    if (!this.client) throw new Error("Gemini API key not configured");

    const start = Date.now();
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" as const : m.role as "user" | "model",
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContentStream({
      model: config.model || "gemini-3.6-flash",
      contents,
      config: systemPrompt ? { systemInstruction: systemPrompt } : undefined,
    });

    let fullText = "";
    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    return {
      text: fullText,
      provider: "gemini",
      model: config.model || "gemini-3.6-flash",
      latencyMs: Date.now() - start,
    };
  }
}

// ── OpenAI Adapter (stub — requires API key) ───────────────────

class OpenAIAdapter implements ProviderAdapter {
  name: LLMProvider = "openai";

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async generate(_messages: LLMMessage[], _config: LLMConfig, _systemPrompt?: string): Promise<LLMResponse> {
    // Stub — implement with OpenAI SDK when key is provided
    throw new Error("OpenAI adapter not yet implemented. Add OPENAI_API_KEY to .env");
  }

  async generateStream(
    _messages: LLMMessage[],
    _config: LLMConfig,
    _onChunk: (chunk: string) => void,
    _systemPrompt?: string,
  ): Promise<LLMResponse> {
    throw new Error("OpenAI adapter not yet implemented. Add OPENAI_API_KEY to .env");
  }
}

// ── Anthropic Adapter (stub) ───────────────────────────────────

class AnthropicAdapter implements ProviderAdapter {
  name: LLMProvider = "anthropic";

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async generate(_messages: LLMMessage[], _config: LLMConfig, _systemPrompt?: string): Promise<LLMResponse> {
    throw new Error("Anthropic adapter not yet implemented. Add ANTHROPIC_API_KEY to .env");
  }

  async generateStream(
    _messages: LLMMessage[],
    _config: LLMConfig,
    _onChunk: (chunk: string) => void,
    _systemPrompt?: string,
  ): Promise<LLMResponse> {
    throw new Error("Anthropic adapter not yet implemented. Add ANTHROPIC_API_KEY to .env");
  }
}

// ── LLM Router ─────────────────────────────────────────────────

/**
 * KERAI LLM Router
 *
 * Provider-independent AI abstraction that:
 * - Routes requests to the best available provider
 * - Supports fallback chains
 * - Tracks latency and token usage
 * - Emits events for observability
 */
class LLMRouter {
  private adapters: Map<LLMProvider, ProviderAdapter> = new Map();
  private activeProvider: LLMProvider = "gemini";
  private fallbackChain: LLMProvider[] = ["gemini", "openai", "anthropic"];

  constructor() {
    this.adapters.set("gemini", new GeminiAdapter());
    this.adapters.set("openai", new OpenAIAdapter());
    this.adapters.set("anthropic", new AnthropicAdapter());
  }

  /**
   * Get the active provider
   */
  getActiveProvider(): LLMProvider {
    return this.activeProvider;
  }

  /**
   * Set the active provider
   */
  setActiveProvider(provider: LLMProvider): void {
    this.activeProvider = provider;
  }

  /**
   * Check which providers are available
   */
  getAvailableProviders(): { provider: LLMProvider; available: boolean }[] {
    return this.fallbackChain.map((p) => ({
      provider: p,
      available: this.adapters.get(p)?.isAvailable() ?? false,
    }));
  }

  /**
   * Generate a response using the active provider (with fallback)
   */
  async generate(
    messages: LLMMessage[],
    systemPrompt?: string,
    config?: Partial<LLMConfig>,
  ): Promise<LLMResponse> {
    const fullConfig: LLMConfig = {
      provider: this.activeProvider,
      model: config?.model || this.getDefaultModel(this.activeProvider),
      ...config,
    };

    // Try active provider first, then fallback chain
    const providersToTry = [this.activeProvider, ...this.fallbackChain.filter((p) => p !== this.activeProvider)];

    for (const provider of providersToTry) {
      const adapter = this.adapters.get(provider);
      if (!adapter || !adapter.isAvailable()) continue;

      try {
        eventBus.emit("llm.request", "llm-router", { provider, model: fullConfig.model });

        const response = await adapter.generate(messages, { ...fullConfig, provider }, systemPrompt);

        eventBus.emit("llm.response", "llm-router", {
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          textLength: response.text.length,
        });

        return response;
      } catch (err) {
        eventBus.emit("llm.error", "llm-router", {
          provider,
          error: err instanceof Error ? err.message : String(err),
        }, "error");
        // Continue to next provider
      }
    }

    throw new Error("No LLM provider available. Check your API keys in .env");
  }

  /**
   * Stream a response using the active provider (with fallback)
   */
  async generateStream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    systemPrompt?: string,
    config?: Partial<LLMConfig>,
  ): Promise<LLMResponse> {
    const fullConfig: LLMConfig = {
      provider: this.activeProvider,
      model: config?.model || this.getDefaultModel(this.activeProvider),
      ...config,
    };

    const providersToTry = [this.activeProvider, ...this.fallbackChain.filter((p) => p !== this.activeProvider)];

    for (const provider of providersToTry) {
      const adapter = this.adapters.get(provider);
      if (!adapter || !adapter.isAvailable()) continue;

      try {
        eventBus.emit("llm.request", "llm-router", { provider, model: fullConfig.model, streaming: true });

        const response = await adapter.generateStream(messages, { ...fullConfig, provider }, onChunk, systemPrompt);

        eventBus.emit("llm.response", "llm-router", {
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          textLength: response.text.length,
          streaming: true,
        });

        return response;
      } catch (err) {
        eventBus.emit("llm.error", "llm-router", {
          provider,
          error: err instanceof Error ? err.message : String(err),
        }, "error");
      }
    }

    throw new Error("No LLM provider available. Check your API keys in .env");
  }

  private getDefaultModel(provider: LLMProvider): string {
    switch (provider) {
      case "gemini": return "gemini-3.6-flash";
      case "openai": return "gpt-4o";
      case "anthropic": return "claude-sonnet-4-20250514";
      default: return "gemini-3.6-flash";
    }
  }
}

export const llmRouter = new LLMRouter();
