import {
  streamText,
  UIMessage,
  convertToModelMessages,
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
import { getCloudProvider } from "@/lib/cloud-providers";
import { compactMessages } from "@/lib/history-compaction";
import { TOOL_APPROVAL_SECRET } from "@/lib/tool-approval-secret";
import { DEFAULT_MODEL, findModel, type ModelOption } from "@/lib/models";

export const maxDuration = 300;

const MEMORY_PATH = ".omniai/memory.md";

const BASE_SYSTEM_PROMPT = `You are OmniAI, an assistant that runs primarily on the user's own hardware via Ollama — no cloud APIs, no keys, no cost by default. You have deep, broad knowledge of programming languages, frameworks, and software design, direct access to the user's local filesystem and shell inside one workspace directory, and the ability to reach the internet (page fetch, real web search, and a real browser) and drive a real Chromium browser. Some conversations may be running on a cloud model the user explicitly opted into for extra capability — if so it's noted below; otherwise assume everything about you, including this conversation, stays on the user's machine.

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
- writeFile, editFile, runCommand, gitCommit, and the interactive browser tools (browserClick, browserType, browserPressKey) require the user's explicit approval before they run. Briefly explain what you're about to do and why before calling one of them.
- If the user denies an approval, do not retry the same action — acknowledge it and ask how to proceed instead.
- Be concise. Don't narrate every single step; do the work and summarize what changed at the end.

Project memory: this workspace may have a memory file at ${MEMORY_PATH} — its current content, if any, is included below. When you learn something durable worth remembering across future chats (project conventions, past decisions, gotchas, the user's stated preferences for this project), write it there with writeFile or editFile. Keep it concise and organized; don't log routine chat content, only things worth recalling later.`;

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
  const system = memory
    ? `${BASE_SYSTEM_PROMPT}${cloudNote}\n\n--- Current ${MEMORY_PATH} ---\n${memory}\n--- end memory ---`
    : `${BASE_SYSTEM_PROMPT}${cloudNote}\n\n(No project memory file yet at ${MEMORY_PATH}.)`;

  const tools = {
    ...createAgentTools(root),
    ...createGitTools(root),
    ...createWebTools(),
    ...(isTavilyConfigured() ? createWebSearchTool() : {}),
    ...createSemanticSearchTool(root),
    ...createBrowserTools(),
    ...createSystemTools(),
  };

  const result = streamText({
    model: languageModel,
    system,
    messages: await convertToModelMessages(compactMessages(messages)),
    tools,
    stopWhen: stepCountIs(20),
    toolApproval: {
      writeFile: "user-approval",
      editFile: "user-approval",
      runCommand: "user-approval",
      gitCommit: "user-approval",
      browserClick: "user-approval",
      browserType: "user-approval",
      browserPressKey: "user-approval",
    },
    experimental_toolApprovalSecret: TOOL_APPROVAL_SECRET,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
