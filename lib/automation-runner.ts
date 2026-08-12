import { generateText, stepCountIs } from "ai";
import { ollama } from "@/lib/ollama";
import { createAgentTools } from "@/lib/agent-tools";
import { createGitTools } from "@/lib/git-tools";
import { createWebTools } from "@/lib/web-tools";
import { createWebSearchTool, isTavilyConfigured } from "@/lib/web-search";
import { createSemanticSearchTool } from "@/lib/semantic-search";
import { createBrowserTools } from "@/lib/browser-tools";
import { createSystemTools } from "@/lib/system-tools";
import { createLocalTools } from "@/lib/local-tools";
import { getCloudProvider } from "@/lib/cloud-providers";
import { findModel, DEFAULT_MODEL } from "@/lib/models";
import type { Automation } from "@/lib/automation-store";

const AUTOMATION_SYSTEM_PROMPT = `You are Kerai AI running an unattended scheduled automation — no one is watching this run in real time. You only have READ-ONLY tools (listing/reading files, git inspection, web fetch/search, browser reading, system status). You cannot write files, run commands, commit, or interact with a page (click/type). If the task genuinely requires one of those, say so plainly in your answer instead of attempting it. Give a concise, complete final answer — this becomes a log entry the user reads later, not a conversation.`;

function readOnlyToolsFor(root: string) {
  const { listDirectory, readFile, searchFiles } = createAgentTools(root);
  const { gitStatus, gitDiff, gitLog } = createGitTools(root);
  const { webFetch } = createWebTools();
  const { browserNavigate, browserGetText, browserScreenshot } = createBrowserTools();
  const { getSystemStatus } = createSystemTools();
  const { getLocalTime, readClipboard } = createLocalTools();
  return {
    listDirectory,
    readFile,
    searchFiles,
    gitStatus,
    gitDiff,
    gitLog,
    webFetch,
    browserNavigate,
    browserGetText,
    browserScreenshot,
    getSystemStatus,
    getLocalTime,
    readClipboard,
    ...createSemanticSearchTool(root),
    ...(isTavilyConfigured() ? createWebSearchTool() : {}),
  };
}

function resolveModel(requestedId: string) {
  const option = findModel(requestedId) ?? findModel(DEFAULT_MODEL)!;
  if (option.provider === "ollama") return ollama.chatModel(option.providerModelId);
  const cloudProvider = getCloudProvider(option.provider);
  if (!cloudProvider) return ollama.chatModel(findModel(DEFAULT_MODEL)!.providerModelId);
  return cloudProvider.chatModel(option.providerModelId);
}

export async function runAutomation(automation: Automation): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(automation.model),
    system: AUTOMATION_SYSTEM_PROMPT,
    prompt: automation.prompt,
    tools: readOnlyToolsFor(automation.workspaceRoot),
    stopWhen: stepCountIs(10),
  });
  return text;
}
