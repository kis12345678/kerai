import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  stepCountIs,
} from "ai";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ollama } from "@/lib/ollama";
import { createAgentTools } from "@/lib/agent-tools";
import { createGitTools } from "@/lib/git-tools";
import { createWebTools } from "@/lib/web-tools";
import { createWebSearchTool, isTavilyConfigured } from "@/lib/web-search";
import { createSemanticSearchTool } from "@/lib/semantic-search";
import { createBrowserTools } from "@/lib/browser-tools";
import { createSystemTools } from "@/lib/system-tools";
import { createLocalTools } from "@/lib/local-tools";
import { createAndroidTools } from "@/lib/android-tools";
import { createDesktopControlTools } from "@/lib/desktop-control";
import { getCloudProvider } from "@/lib/cloud-providers";
import { compactMessages } from "@/lib/history-compaction";
import { TOOL_APPROVAL_SECRET } from "@/lib/tool-approval-secret";
import { buildToolApproval, unclassifiedTools, isMutatingTool } from "@/lib/tool-risk";
import { recordAudit, describeTarget, collectDenied } from "@/lib/audit";
import { DEFAULT_MODEL, findModel, type ModelOption } from "@/lib/models";
import { AGENTS, getAgent, toolsForAgent } from "@/lib/agents";
import { routeTask, lastUserText } from "@/lib/agent-router";
import { collectOutcomes, verifyTurn, errorFrom } from "@/lib/critic";

export const maxDuration = 300;

const MEMORY_PATH = ".omniai/memory.md";

const BASE_SYSTEM_PROMPT = `You are Kerai AI, an assistant that runs primarily on the user's own hardware via Ollama — no cloud APIs, no keys, no cost by default. You have deep, broad knowledge of programming languages, frameworks, and software design, direct access to the user's local filesystem and shell inside one workspace directory, and the ability to reach the internet (page fetch, real web search, and a real browser) and drive a real Chromium browser. Some conversations may be running on a cloud model the user explicitly opted into for extra capability — if so it's noted below; otherwise assume everything about you, including this conversation, stays on the user's machine.

You cover several kinds of requests in the same conversation, and you decide which one fits — the user should never have to pick a "mode":

1. Plain conversation — questions, explanations, brainstorming, advice. Just answer directly, no tools needed.
2. Building an app — when asked to build/create/make an app, tool, page, or prototype, write ONE complete, self-contained HTML file (inline <style> and <script>, no external files, no build step) via writeFile. Make it polished: real layout, spacing, a coherent color scheme, hover states, responsive sizing. You may use React via CDN (unpkg React 18 + Babel standalone) if it genuinely helps, but prefer plain HTML/CSS/JS for simple apps. Put it somewhere sensible like "apps/<name>.html".
3. Working in the real codebase — reading, searching, editing, or refactoring actual project files, running builds/tests/scripts, or making git commits.
4. Looking things up or acting on the web — searching, fetching docs/pages, or driving a real browser to navigate, read, and interact with a site when a request needs live web interaction rather than just a fetch.

Tool guidance:
- Use listDirectory and readFile freely to explore before making changes; you don't need permission for these.
- Use searchFiles for exact-text lookups; use semanticSearch when you don't know the exact wording and need to find conceptually related code (it builds a local embeddings index the first time it's used).
- Use editFile for small, targeted changes to existing files (oldString must be unique in the file). Use writeFile for new files, full rewrites, or generated apps.
- Use runCommand for builds, tests, installs, or scripts — it's a persistent terminal scoped to this workspace, so cd/env vars/background processes carry over between calls like a real terminal tab.
- Use gitStatus/gitDiff/gitLog freely to inspect repo state; use gitCommit only when the user actually wants a commit made.
- Use webFetch to read a URL's content you already know (docs, error messages, API references). Use webSearch when you don't know the exact URL and need to find one, or need current information — it's a real search API, not a guess.
- Use the browser* tools when a task genuinely needs a live browser (JS-rendered pages, logging into a site, clicking through a flow, screenshotting a page) rather than just reading a URL's raw content — that's what webFetch is for.
- Use getSystemStatus for questions about this machine's live state (battery, CPU load, memory usage, uptime) — it reads real OS data, not a guess.
- Use getLocalTime whenever the answer depends on the current date or time — your training data can't know what time it is.
- Use readClipboard to grab text the user copied elsewhere (e.g. "summarize what I just copied"), writeClipboard to copy text to their clipboard, and openInBrowser to open a URL in their real, visible default browser.
- writeFile, editFile, runCommand, gitCommit, writeClipboard, openInBrowser, and the interactive browser tools (browserClick, browserType, browserPressKey) require the user's explicit approval before they run. Briefly explain what you're about to do and why before calling one of them.
- If the user denies an approval, do not retry the same action — acknowledge it and ask how to proceed instead.
- Be concise. Don't narrate every single step; do the work and summarize what changed at the end.

Language: understand and reply in whatever language the user writes in — Hindi, Gujarati, Tamil, Marathi, Bengali, Telugu, Punjabi, Kannada, Malayalam, any Indian language, or English. Match their language and script; if they switch languages, follow. Code, commands, and file contents stay in their original language regardless.

Project memory: this workspace may have a memory file at ${MEMORY_PATH} — its current content, if any, is included below. When you learn something durable worth remembering across future chats (project conventions, past decisions, gotchas, the user's stated preferences for this project), write it there with writeFile or editFile. Keep it concise and organized; don't log routine chat content, only things worth recalling later.`;

// An unclassified tool still fails closed (buildToolApproval gives it "user-approval"), but that
// is a safety net, not the intent — it means someone added a tool and didn't say what it does.
// Warned once per process rather than per request so it's visible without flooding the log.
let toolRiskAudited = false;
function auditToolRisk(toolNames: string[]): void {
  if (toolRiskAudited) return;
  toolRiskAudited = true;
  const missing = unclassifiedTools(toolNames);
  if (missing.length > 0) {
    console.warn(
      `[tool-risk] Unclassified, defaulting to user approval: ${missing.join(", ")}. ` +
        `Classify them in TOOL_RISK (lib/tool-risk.ts).`
    );
  }
}

async function loadProjectMemory(root: string): Promise<string | null> {
  try {
    const content = await readFile(path.join(root, MEMORY_PATH), "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

function resolveModel(requestedId: string | undefined) {
  const requested = requestedId ? findModel(requestedId) : undefined;
  const option: ModelOption = requested ?? findModel(DEFAULT_MODEL)!;

  if (option.provider === "ollama") {
    return { option, languageModel: ollama.chatModel(option.providerModelId) };
  }

  const cloudProvider = getCloudProvider(option.provider);
  if (!cloudProvider) {
    // Selected model's provider key isn't configured server-side (e.g. stale localStorage
    // selection from before a key was removed) — fall back to the local default instead of
    // erroring the whole request.
    const fallback = findModel(DEFAULT_MODEL)!;
    return { option: fallback, languageModel: ollama.chatModel(fallback.providerModelId) };
  }
  return { option, languageModel: cloudProvider.chatModel(option.providerModelId) };
}

export async function POST(req: Request) {
  const {
    messages,
    model,
    workspaceRoot,
  }: { messages: UIMessage[]; model?: string; workspaceRoot?: string } = await req.json();

  const root = workspaceRoot?.trim() || process.cwd();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return new Response(JSON.stringify({ error: `Workspace path does not exist: ${root}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { option: modelOption, languageModel } = resolveModel(model);
  const memory = await loadProjectMemory(root);
  const cloudNote =
    modelOption.provider !== "ollama"
      ? `\n\nNote: this conversation is running on ${modelOption.label} — a cloud model routed via ${modelOption.vendor}, chosen deliberately by the user. Unlike the default, this conversation's messages leave the machine.`
      : "";
  // Kerai AI dispatches rather than doing everything itself: pick the specialist first, then
  // run the turn as that specialist with only its own tools.
  const { agent: agentId, reason: routingReason } = await routeTask({
    messages,
    model: languageModel,
  });
  const agent = getAgent(agentId);

  const roster = Object.values(AGENTS)
    .map((a) => `- ${a.name} — ${a.blurb}`)
    .join("\n");
  const teamNote = `\n\nYou are not answering as Kerai AI directly. Kerai AI is the orchestrator the user talks to, and it has assigned this turn to one of its three specialists. The section below tells you which one you are; it takes precedence over the general framing above, and in particular you only have the tools listed for you — the others genuinely are not available on this turn.

Kerai AI's specialists:
${roster}`;

  const memoryBlock = memory
    ? `--- Current ${MEMORY_PATH} ---\n${memory}\n--- end memory ---`
    : `(No project memory file yet at ${MEMORY_PATH}.)`;

  const system = `${BASE_SYSTEM_PROMPT}${cloudNote}${teamNote}\n\n${agent.persona}\n\n${memoryBlock}`;

  const allTools = {
    ...createAgentTools(root),
    ...createGitTools(root),
    ...createWebTools(),
    ...(isTavilyConfigured() ? createWebSearchTool() : {}),
    ...createSemanticSearchTool(root),
    ...createBrowserTools(),
    ...createSystemTools(),
    ...createLocalTools(),
    ...createAndroidTools(root),
    ...createDesktopControlTools(),
  };
  auditToolRisk(Object.keys(allTools));
  const tools = toolsForAgent(agent, allTools);

  const modelMessages = await convertToModelMessages(compactMessages(messages));
  const baseCall = {
    model: languageModel,
    system,
    tools,
    stopWhen: stepCountIs(20),
    // Derived from lib/tool-risk.ts rather than listed here, so the classification lives next to
    // the tools and an unclassified tool fails closed instead of silently running ungated.
    toolApproval: buildToolApproval(Object.keys(tools)),
    experimental_toolApprovalSecret: TOOL_APPROVAL_SECRET,
  };

  const agentMetadata = { agent: agent.id, agentName: agent.name, agentEmoji: agent.emoji };

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const first = streamText({ ...baseCall, messages: modelMessages });

      writer.merge(
        toUIMessageStream({
          stream: first.stream,
          // Tells the client which specialist took the turn, so the UI can label the reply.
          messageMetadata: ({ part }) =>
            part.type === "start" ? { ...agentMetadata, routing: routingReason } : undefined,
        })
      );

      // Everything below runs after the reply has already streamed to the user, so verification
      // costs them nothing on the common path where the turn changed nothing or plainly worked.
      const steps = await first.steps;
      const { outcomes, complete } = collectOutcomes(steps);
      const request = lastUserText(messages);

      // Log what ran before deciding anything else, so an action is recorded even on the paths
      // that return early below. Not awaited: the user already has their reply, and a slow disk
      // must not hold the response open.
      void recordAudit(root, [
        ...outcomes
          .filter((o) => isMutatingTool(o.toolName, o.input))
          .map((o) => {
            const error = errorFrom(o.output);
            return {
              kind: "tool" as const,
              at: new Date().toISOString(),
              agent: agent.id,
              tool: o.toolName,
              target: describeTarget(o.input),
              gated: true,
              outcome: error ? ("error" as const) : ("success" as const),
              ...(error ? { detail: error } : {}),
            };
          }),
        // The user's refusals matter more than the successes here: this is the record of them
        // saying no, and of it being honoured.
        ...collectDenied(steps).map((d) => ({
          kind: "tool" as const,
          at: new Date().toISOString(),
          agent: agent.id,
          tool: d.toolName,
          target: describeTarget(d.input),
          gated: true,
          outcome: "denied" as const,
        })),
      ]);

      // An incomplete turn is one that stopped to ask for approval (or had one denied). The user
      // is mid-decision; there is nothing to verify yet, and the client re-sends once they answer.
      if (!complete) return;

      const verdict = await verifyTurn({ request, outcomes, model: languageModel });

      // Recorded whether it passed or failed — "checked and fine" and "couldn't check" are both
      // worth being able to look up later, and the tier distinguishes them.
      if (outcomes.some((o) => isMutatingTool(o.toolName, o.input))) {
        void recordAudit(root, [
          {
            kind: "verification",
            at: new Date().toISOString(),
            agent: agent.id,
            request: request.slice(0, 300),
            ok: verdict.ok,
            tier: verdict.tier,
            ...(verdict.ok ? {} : { reason: verdict.reason }),
          },
        ]);
      }

      if (verdict.ok) return;

      // One retry, never more. The point is to catch the case where the model didn't notice its
      // own failure — not to grind a genuinely impossible task against a slow local model. If the
      // second attempt is also wrong, that surfaces to the user instead of looping.
      const retry = streamText({
        ...baseCall,
        messages: [
          ...modelMessages,
          ...(await first.response).messages,
          {
            role: "user" as const,
            content: `[Automated verification — not from the user]\n\nThat attempt does not appear to have worked: ${verdict.reason}\n\nCheck what actually happened, fix it if it is genuinely broken, and tell the user plainly what went wrong and what you did about it. If on inspection the work was in fact correct, just say so briefly — do not redo it.`,
          },
        ],
      });

      writer.merge(
        toUIMessageStream({
          stream: retry.stream,
          // Marks the follow-up as a verification retry so the UI can label it as one rather than
          // showing an unexplained second reply.
          messageMetadata: ({ part }) =>
            part.type === "start"
              ? {
                  ...agentMetadata,
                  routing: routingReason,
                  verification: { failed: true, reason: verdict.reason, tier: verdict.tier },
                }
              : undefined,
        })
      );
    },
    onError: (error) => (error as Error)?.message ?? "An error occurred.",
  });

  return createUIMessageStreamResponse({ stream });
}
