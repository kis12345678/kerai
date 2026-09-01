import { llmRouter } from "./llm-router.js";
import { toolRegistry } from "./registry.js";
import { eventBus } from "./events.js";
import { parseIntent, type ParsedIntent, type IntentCategory } from "./intent.js";
import type { TaskStep, LLMMessage, ToolCategory } from "@shared/api";
import crypto from "node:crypto";

// ── Plan Types ─────────────────────────────────────────────────

export interface Plan {
  id: string;
  objective: string;
  steps: TaskStep[];
  requiresConfirmation: boolean;
  estimatedPermissions: number; // max permission level needed
  reasoning: string;
  createdAt: string;
}

// ── Built-in Plan Templates ────────────────────────────────────

interface PlanTemplate {
  match: (intent: ParsedIntent) => boolean;
  build: (intent: ParsedIntent, message: string) => Plan;
}

const PLAN_TEMPLATES: PlanTemplate[] = [
  // System status query
  {
    match: (i) => i.category === "system_info" && i.toolsNeeded.length > 0,
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "Get system status", "system.get_status"),
        ...(message.toLowerCase().includes("process") ? [makeStep(2, "List running processes", "system.list_processes")] : []),
        ...(message.toLowerCase().includes("disk") ? [makeStep(2, "Get disk usage", "system.get_disk_usage")] : []),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "System status query — read-only, no confirmation needed",
      createdAt: new Date().toISOString(),
    }),
  },

  // File read
  {
    match: (i) => i.category === "file_operation" && i.toolsNeeded.includes("files.read"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "Read file contents", "files.read", intent.parameters),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 1,
      reasoning: "File read — level 1 permission, low risk",
      createdAt: new Date().toISOString(),
    }),
  },

  // File list
  {
    match: (i) => i.category === "file_operation" && i.toolsNeeded.includes("files.list"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "List directory contents", "files.list", intent.parameters),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "File listing — read-only, no confirmation needed",
      createdAt: new Date().toISOString(),
    }),
  },

  // Automation listing
  {
    match: (i) => i.category === "automation" && i.toolsNeeded.includes("automation.list"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "List automations", "automation.list"),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "Automation listing — read-only",
      createdAt: new Date().toISOString(),
    }),
  },

  // Integration listing
  {
    match: (i) => i.category === "integration" && i.toolsNeeded.includes("integration.list"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "List integrations", "integration.list"),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "Integration listing — read-only",
      createdAt: new Date().toISOString(),
    }),
  },

  // Integration sync
  {
    match: (i) => i.category === "integration" && i.toolsNeeded.includes("integration.sync"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "Sync integration", "integration.sync", intent.parameters),
      ],
      requiresConfirmation: true,
      estimatedPermissions: 1,
      reasoning: "Integration sync — level 1, requires confirmation",
      createdAt: new Date().toISOString(),
    }),
  },

  // Logs
  {
    match: (i) => i.category === "logs" && i.toolsNeeded.includes("logs.read"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "Read activity logs", "logs.read"),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "Log reading — read-only",
      createdAt: new Date().toISOString(),
    }),
  },

  // Settings
  {
    match: (i) => i.category === "settings" && i.toolsNeeded.includes("settings.get"),
    build: (intent, message) => ({
      id: generatePlanId(),
      objective: message,
      steps: [
        makeStep(1, "Get settings", "settings.get"),
      ],
      requiresConfirmation: false,
      estimatedPermissions: 0,
      reasoning: "Settings query — read-only",
      createdAt: new Date().toISOString(),
    }),
  },
];

// ── Planner Engine ─────────────────────────────────────────────

/**
 * KERAI Planner Engine
 *
 * Given a user message, creates a step-by-step execution plan.
 * Uses templates for common requests and LLM for complex ones.
 */
export class PlannerEngine {
  /**
   * Plan a request: parse intent, then create a plan
   */
  async plan(message: string): Promise<Plan> {
    const intent = await parseIntent(message);

    eventBus.emit("task.created", "planner", {
      category: intent.category,
      toolsNeeded: intent.toolsNeeded,
      message: message.slice(0, 100),
    });

    // Try template-based planning first (fast, deterministic)
    for (const template of PLAN_TEMPLATES) {
      if (template.match(intent)) {
        const plan = template.build(intent, message);
        console.log(`[planner] Template plan: ${plan.steps.length} steps — ${plan.reasoning}`);
        return plan;
      }
    }

    // For complex tasks and conversations, use LLM planning
    if (intent.category === "task") {
      return this.planWithLLM(message, intent);
    }

    // Simple conversation — no tools needed
    if (intent.category === "conversation") {
      return {
        id: generatePlanId(),
        objective: message,
        steps: [], // No steps — just generate a response
        requiresConfirmation: false,
        estimatedPermissions: 0,
        reasoning: "Casual conversation — no tool execution needed",
        createdAt: new Date().toISOString(),
      };
    }

    // Fallback: single step with detected tools
    return {
      id: generatePlanId(),
      objective: message,
      steps: intent.toolsNeeded.map((toolName, i) =>
        makeStep(i + 1, `Execute ${toolName}`, toolName, intent.parameters)
      ),
      requiresConfirmation: intent.requiresConfirmation,
      estimatedPermissions: intent.toolsNeeded.reduce((max, t) => {
        const def = toolRegistry.get(t);
        return Math.max(max, def?.permissionLevel || 0);
      }, 0),
      reasoning: `Fallback plan — ${intent.toolsNeeded.length} tool(s) detected`,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Use LLM to create a plan for complex multi-step tasks
   */
  private async planWithLLM(message: string, intent: ParsedIntent): Promise<Plan> {
    const tools = toolRegistry.getAll().filter((t) => t.enabled);
    const toolList = tools.map(
      (t) => `- ${t.name}: ${t.description} [category=${t.category}, permission=${t.permissionLevel}, risk=${t.riskLevel}]`
    ).join("\n");

    const systemPrompt = `You are KERAI's planning engine. Given a user request, create a step-by-step execution plan using the available tools.

Available tools:
${toolList}

Respond with ONLY a JSON object (no markdown):
{
  "steps": [
    {
      "order": 1,
      "description": "Brief description of this step",
      "toolName": "tool.name or null if no tool needed",
      "input": {}
    }
  ],
  "requiresConfirmation": false,
  "reasoning": "Why this plan"
}

Rules:
- Order steps logically (dependencies first)
- Each step should do ONE thing
- Use null for toolName if a step doesn't need a tool
- Set requiresConfirmation to true if any step uses permission >= 2
- Keep it concise — max 10 steps
- If it's a simple question, use 0 steps (just answer directly)`;

    const messages: LLMMessage[] = [{ role: "user", content: message }];

    const response = await llmRouter.generate(messages, systemPrompt, {
      temperature: 0.1,
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("LLM did not return valid JSON for planning");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const steps: TaskStep[] = (parsed.steps || []).map((s: any, i: number) => ({
      id: `step-${i + 1}-${crypto.randomUUID().slice(0, 6)}`,
      order: s.order || i + 1,
      description: s.description || `Step ${i + 1}`,
      toolName: s.toolName || undefined,
      input: s.input || {},
      status: "queued" as const,
    }));

    const maxPermission = steps.reduce((max: number, s: TaskStep) => {
      if (!s.toolName) return max;
      const def = toolRegistry.get(s.toolName);
      return Math.max(max, def?.permissionLevel || 0);
    }, 0);

    return {
      id: generatePlanId(),
      objective: message,
      steps,
      requiresConfirmation: parsed.requiresConfirmation || maxPermission >= 2,
      estimatedPermissions: maxPermission,
      reasoning: parsed.reasoning || "LLM-generated plan",
      createdAt: new Date().toISOString(),
    };
  }
}

export const planner = new PlannerEngine();

// ── Helpers ────────────────────────────────────────────────────

function generatePlanId(): string {
  return `plan-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function makeStep(
  order: number,
  description: string,
  toolName: string,
  input?: Record<string, unknown>,
): TaskStep {
  return {
    id: `step-${order}-${crypto.randomUUID().slice(0, 6)}`,
    order,
    description,
    toolName,
    input: input || {},
    status: "queued",
  };
}
