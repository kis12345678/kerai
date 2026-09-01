import { llmRouter } from "./llm-router.js";
import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import type { LLMMessage } from "@shared/api";

// ── Intent Types ───────────────────────────────────────────────

export type IntentCategory =
  | "query"          // Simple question (no tools needed)
  | "system_info"    // Get system status/processes/disk
  | "file_operation" // Read/write/list files
  | "automation"     // List/toggle/manage automations
  | "integration"    // List/sync integrations
  | "settings"       // Get/update settings
  | "logs"           // Read activity logs
  | "task"           // Complex multi-step request
  | "conversation"   // Casual chat, feelings, greetings
  | "unknown";       // Could not classify

export interface ParsedIntent {
  category: IntentCategory;
  confidence: number;          // 0-1
  originalMessage: string;
  cleanedMessage: string;      // message without greeting/filler
  toolsNeeded: string[];       // tool names required
  parameters: Record<string, unknown>;
  requiresConfirmation: boolean;
  reasoning: string;           // why this intent was chosen
}

// ── Intent Patterns (fast, local, no LLM needed) ──────────────

interface IntentPattern {
  patterns: RegExp[];
  category: IntentCategory;
  tools: string[];
  extract?: (match: RegExpMatchArray, message: string) => Record<string, unknown>;
}

const LOCAL_PATTERNS: IntentPattern[] = [
  // System info
  {
    patterns: [
      /\b(system\s*status|how.*(cpu|memory|ram|disk|uptime)|what'?s?\s*(the\s*)?(system|computer|pc)\s*(doing|status|like))\b/i,
      /\b(processes?|running\s*(apps?|programs?))\b/i,
      /\b(disk\s*(space|usage)|storage)\b/i,
    ],
    category: "system_info",
    tools: ["system.get_status"],
  },

  // File operations
  {
    patterns: [
      /\b(read|open|show|cat|view|what'?s?\s*in)\s+(the\s+)?file\s+(.+?)(?:\s*$)/i,
    ],
    category: "file_operation",
    tools: ["files.read"],
    extract: (_match, message) => {
      const fileMatch = message.match(/\b(?:read|open|show|cat|view|what'?s?\s*in)\s+(?:the\s+)?file\s+(.+?)(?:\s*$)/i);
      return { path: fileMatch?.[1]?.trim() || "" };
    },
  },
  {
    patterns: [
      /\b(list|show|ls|dir)\s+(?:the\s+)?(?:files?|folder|directory|contents?)\b/i,
    ],
    category: "file_operation",
    tools: ["files.list"],
  },
  {
    patterns: [
      /\b(write|create|save)\s+(?:a\s+)?(?:file|document)\b/i,
    ],
    category: "file_operation",
    tools: ["files.write"],
  },

  // Automations
  {
    patterns: [
      /\b(what'?s?\s*(the\s*)?automations?|list\s*automations?|show\s*automations?)\b/i,
      /\b(automations?|workflows?)\s*(status|running|active|list)\b/i,
    ],
    category: "automation",
    tools: ["automation.list"],
  },
  {
    patterns: [
      /\b(toggle|enable|disable|activate|deactivate)\s+(?:the\s+)?automation\b/i,
    ],
    category: "automation",
    tools: ["automation.toggle"],
  },

  // Integrations
  {
    patterns: [
      /\b(what'?s?\s*(the\s*)?integrations?|list\s*integrations?|show\s*integrations?|connected\s*services?)\b/i,
      /\b(outlook|teams|onedrive|excel|word)\s*(status|connected|sync)\b/i,
    ],
    category: "integration",
    tools: ["integration.list"],
  },
  {
    patterns: [
      /\bsync\s+(?:the\s+)?(outlook|teams|onedrive|excel|word)\b/i,
    ],
    category: "integration",
    tools: ["integration.sync"],
  },

  // Settings
  {
    patterns: [
      /\b(show|get|what)?\s*(?:are\s+)?(?:the\s+)?settings?\b/i,
      /\b(configuration|preferences)\b/i,
    ],
    category: "settings",
    tools: ["settings.get"],
  },

  // Logs
  {
    patterns: [
      /\b(show|get|read|list|what)?\s*(?:the\s+)?(?:activity\s+)?logs?\b/i,
      /\b(what'?s?\s*happened|recent\s*activity|recent\s*events?)\b/i,
    ],
    category: "logs",
    tools: ["logs.read"],
  },

  // Greetings / casual
  {
    patterns: [
      /\b^(hey|hi|hello|yo|sup|good\s*(morning|afternoon|evening|night))\b/i,
      /\bhow\s*are\s*you\b/i,
      /\bwhat'?s?\s*up\b/i,
    ],
    category: "conversation",
    tools: [],
  },

  // Feelings
  {
    patterns: [
      /\b(i'?m?\s*(feeling|feels?|am|was)\s+)?(sad|depressed|down|unhappy|stressed|anxious|worried|overwhelmed|tired|exhausted|bored|lonely|happy|excited|great|amazing|good|wonderful)\b/i,
    ],
    category: "conversation",
    tools: [],
  },
];

// ── Intent Parser ──────────────────────────────────────────────

/**
 * Parse a user message into a structured intent.
 * Uses fast local pattern matching first, falls back to LLM for complex messages.
 */
export async function parseIntent(message: string): Promise<ParsedIntent> {
  const trimmed = message.trim();

  // Step 1: Try fast local pattern matching
  const localMatch = matchLocalPatterns(trimmed);
  if (localMatch && localMatch.confidence >= 0.8) {
    eventBus.emit("llm.request", "intent-parser", {
      method: "local-pattern",
      category: localMatch.category,
      confidence: localMatch.confidence,
    });
    return localMatch;
  }

  // Step 2: Use LLM for complex classification
  try {
    const llmIntent = await classifyWithLLM(trimmed);
    if (llmIntent.confidence >= 0.5) {
      return llmIntent;
    }
  } catch (err) {
    console.error("[intent-parser] LLM classification failed, falling back to local:", err);
  }

  // Step 3: Fallback — if local matched with low confidence, use it
  if (localMatch) {
    return localMatch;
  }

  // Step 4: Default to conversation
  return {
    category: "conversation",
    confidence: 0.3,
    originalMessage: trimmed,
    cleanedMessage: trimmed,
    toolsNeeded: [],
    parameters: {},
    requiresConfirmation: false,
    reasoning: "No patterns matched, defaulting to conversation",
  };
}

// ── Local Pattern Matcher ──────────────────────────────────────

function matchLocalPatterns(message: string): ParsedIntent | null {
  const lower = message.toLowerCase();

  // Check if it's a complex multi-step request
  const multiStepIndicators = [
    /\b(prepare|compile|gather|collect|summarize|analyze|organize)\b/i,
    /\b(and\s+then|after\s+that|also\s+(look|check|find|get|search))\b/i,
    /\b(before|after|first|then|next|finally|lastly)\b/i,
    /\b(meeting|briefing|report|presentation|document)\b/i,
  ];

  const isMultiStep = multiStepIndicators.some((p) => p.test(message));
  if (isMultiStep) {
    return {
      category: "task",
      confidence: 0.7,
      originalMessage: message,
      cleanedMessage: message,
      toolsNeeded: [], // Planner will determine tools
      parameters: {},
      requiresConfirmation: false,
      reasoning: "Multi-step indicators detected — delegating to planner",
    };
  }

  for (const intentPattern of LOCAL_PATTERNS) {
    for (const pattern of intentPattern.patterns) {
      const match = message.match(pattern);
      if (match) {
        const params = intentPattern.extract?.(match, message) || {};

        // Validate that all needed tools exist
        const validTools = intentPattern.tools.filter((t) => toolRegistry.isAvailable(t));

        return {
          category: intentPattern.category,
          confidence: 0.85,
          originalMessage: message,
          cleanedMessage: message,
          toolsNeeded: validTools,
          parameters: params,
          requiresConfirmation: intentPattern.tools.some((t) => {
            const def = toolRegistry.get(t);
            return def?.requiresConfirmation || false;
          }),
          reasoning: `Matched local pattern: ${pattern.source.slice(0, 50)}`,
        };
      }
    }
  }

  return null;
}

// ── LLM Classification ─────────────────────────────────────────

async function classifyWithLLM(message: string): Promise<ParsedIntent> {
  // Get available tools for the system prompt
  const tools = toolRegistry.getAll().filter((t) => t.enabled);
  const toolList = tools.map((t) => `- ${t.name}: ${t.description} [category=${t.category}, permission=${t.permissionLevel}]`).join("\n");

  const systemPrompt = `You are KERAI's intent parser. Classify the user's message into ONE category and list which tools are needed.

Available tools:
${toolList}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "category": "one of: query, system_info, file_operation, automation, integration, settings, logs, task, conversation",
  "toolsNeeded": ["tool.name1", "tool.name2"],
  "parameters": {},
  "requiresConfirmation": false,
  "reasoning": "brief explanation"
}

Rules:
- "query" = simple question that doesn't need tools
- "system_info" = asking about CPU, memory, processes, disk
- "file_operation" = reading, writing, listing files
- "automation" = managing automations
- "integration" = managing integrations (Outlook, Teams, etc.)
- "settings" = viewing/modifying settings
- "logs" = reading activity logs
- "task" = complex multi-step request (needs planning)
- "conversation" = casual chat, feelings, greetings

If the request is complex, involves multiple services, or requires multiple steps → use "task".`;

  const messages: LLMMessage[] = [
    { role: "user", content: message },
  ];

  const response = await llmRouter.generate(messages, systemPrompt, {
    temperature: 0.1,
  });

  // Parse JSON response
  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM did not return valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const category = (parsed.category || "conversation") as IntentCategory;
  const toolsNeeded = (parsed.toolsNeeded || []).filter((t: string) => toolRegistry.isAvailable(t));

  return {
    category,
    confidence: 0.7,
    originalMessage: message,
    cleanedMessage: message,
    toolsNeeded,
    parameters: parsed.parameters || {},
    requiresConfirmation: parsed.requiresConfirmation || false,
    reasoning: parsed.reasoning || "LLM classification",
  };
}

// ── Intent Summary (for display) ───────────────────────────────

export function intentSummary(intent: ParsedIntent): string {
  const toolNames = intent.toolsNeeded.length > 0
    ? `Tools: ${intent.toolsNeeded.join(", ")}`
    : "No tools needed";
  return `[${intent.category}] (confidence: ${Math.round(intent.confidence * 100)}%) — ${toolNames}`;
}
