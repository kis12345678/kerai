import { RequestHandler } from "express";
import { store, generateId } from "../store.js";
import { generateWraithResponse, streamWraithResponse } from "../lib/llm.js";
import { parseIntent } from "../lib/intent.js";
import { taskEngine } from "../lib/tasks.js";
import type { CommandRequest, CommandResponse } from "@shared/api";

// In-memory conversation history per user (keeps last 20 turns)
const MAX_HISTORY = 20;
const _conversationHistory: Map<string, Array<{ role: "user" | "model"; parts: string }>> = new Map();

function detectAction(text: string): CommandResponse["action"] | undefined {
  const lower = text.toLowerCase();

  if (lower.includes("inbox") || lower.includes("mail") || lower.includes("email")) {
    return { type: "integration", target: "Outlook", result: "Inbox triaged" };
  }
  if (lower.includes("meeting") || lower.includes("brief")) {
    return { type: "integration", target: "Teams", result: "Brief compiled" };
  }
  if (lower.includes("backup") || lower.includes("sync")) {
    return { type: "integration", target: "OneDrive", result: "Files synced" };
  }
  if (lower.includes("report") || lower.includes("data") || lower.includes("excel")) {
    return { type: "integration", target: "Excel", result: "Report generated" };
  }
  if (lower.includes("automat") || lower.includes("schedule")) {
    return { type: "automation", result: "Automation queued" };
  }
  if (lower.includes("status") || lower.includes("health")) {
    return { type: "system", result: "All systems nominal" };
  }
  return undefined;
}

export const handleCommandPost: RequestHandler = async (req, res) => {
  const { text, userId = "default" } = req.body as CommandRequest;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Command text is required" });
    return;
  }

  const message = text.trim();

  // Log the user command
  store.logs.add({
    id: generateId("log"),
    level: "info",
    source: "console",
    message: `[user] ${message}`,
    timestamp: new Date().toISOString(),
  });

  // ── Smart routing: Intent Parser → Task Engine vs. Simple Chat ──
  try {
    const intent = await parseIntent(message);
    const needsTools = intent.toolsNeeded.length > 0;

    if (needsTools) {
      // Route through the Task Engine for tool-execution requests
      console.log(`[commands] Routing to Task Engine: [${intent.category}] tools=${intent.toolsNeeded.join(", ")}`);
      const taskResult = await taskEngine.execute(message);

      const action = detectAction(message);
      const response: CommandResponse = {
        id: generateId("cmd"),
        role: "wraith",
        text: taskResult.response,
        timestamp: new Date().toISOString(),
        action,
      };

      store.commands.add(response);
      store.logs.add({
        id: generateId("log"),
        level: "success",
        source: "wraith",
        message: `[wraith] ${taskResult.response}`,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json(response);
      return;
    }
  } catch (err) {
    console.error("[commands] Intent/task failed, falling back to chat:", err);
  }

  // ── Simple chat: no tools needed ───────────────────────────
  const action = detectAction(message);

  // Get conversation history for this user
  if (!_conversationHistory.has(userId)) {
    _conversationHistory.set(userId, []);
  }
  const history = _conversationHistory.get(userId)!;

  // Generate response from Gemini (with fallback)
  const persona = store.settings.get().persona;
  let replyText: string;
  try {
    replyText = await generateWraithResponse(message, history, persona);
  } catch (err) {
    console.error("[wraith] Failed to generate response:", err);
    replyText = "WRAITH encountered an error processing that. Try again.";
  }

  // Update conversation history
  history.push({ role: "user", parts: message });
  history.push({ role: "model", parts: replyText });
  // Trim to max history
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  const response: CommandResponse = {
    id: generateId("cmd"),
    role: "wraith",
    text: replyText,
    timestamp: new Date().toISOString(),
    action,
  };

  store.commands.add(response);

  // Log the WRAITH response
  store.logs.add({
    id: generateId("log"),
    level: "success",
    source: "wraith",
    message: `[wraith] ${replyText}`,
    timestamp: new Date().toISOString(),
  });

  // If the command triggered an integration action, log it
  if (action?.type === "integration" && action.target) {
    store.logs.add({
      id: generateId("log"),
      level: "info",
      source: action.target.toLowerCase(),
      message: `[${action.target}] ${action.result}`,
      timestamp: new Date().toISOString(),
    });
  }

  res.status(200).json(response);
};

/**
 * POST /api/commands/stream — streaming SSE version of command post.
 * Sends events: { type: "chunk", text } | { type: "done", id, action, fullText } | { type: "error", error }
 */
export const handleCommandStream: RequestHandler = async (req, res) => {
  const { text, userId = "default" } = req.body as CommandRequest;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Command text is required" });
    return;
  }

  const message = text.trim();

  // Log the user command
  store.logs.add({
    id: generateId("log"),
    level: "info",
    source: "console",
    message: `[user] ${message}`,
    timestamp: new Date().toISOString(),
  });

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // ── Smart routing for streaming ─────────────────────────────
  try {
    const intent = await parseIntent(message);
    const needsTools = intent.toolsNeeded.length > 0;

    if (needsTools) {
      // Route through Task Engine — send plan + result as chunks
      console.log(`[commands-stream] Routing to Task Engine: [${intent.category}]`);
      const taskResult = await taskEngine.execute(message);

      const action = detectAction(message);
      const responseId = generateId("cmd");

      // Send the response as a single chunk (task engine already generated the summary)
      res.write(`data: ${JSON.stringify({ type: "chunk", text: taskResult.response })}\n\n`);

      const savedResponse: CommandResponse = {
        id: responseId,
        role: "wraith",
        text: taskResult.response,
        timestamp: new Date().toISOString(),
        action,
      };
      store.commands.add(savedResponse);

      store.logs.add({
        id: generateId("log"),
        level: "success",
        source: "wraith",
        message: `[wraith] ${taskResult.response}`,
        timestamp: new Date().toISOString(),
      });

      res.write(`data: ${JSON.stringify({ type: "done", id: responseId, action, fullText: taskResult.response, timestamp: savedResponse.timestamp })}\n\n`);
      res.end();
      return;
    }
  } catch (err) {
    console.error("[commands-stream] Intent/task failed, falling back to chat:", err);
  }

  // ── Simple chat streaming ──────────────────────────────────
  const action = detectAction(message);

  // Get conversation history
  if (!_conversationHistory.has(userId)) {
    _conversationHistory.set(userId, []);
  }
  const history = _conversationHistory.get(userId)!;

  try {
    let fullText = "";

    const persona = store.settings.get().persona;
    await streamWraithResponse(message, history, (chunk) => {
      fullText += chunk;
      res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
    }, persona);

    // Update conversation history
    history.push({ role: "user", parts: message });
    history.push({ role: "model", parts: fullText });
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    const responseId = generateId("cmd");

    // Save to store
    const savedResponse: CommandResponse = {
      id: responseId,
      role: "wraith",
      text: fullText,
      timestamp: new Date().toISOString(),
      action,
    };
    store.commands.add(savedResponse);

    // Log the response
    store.logs.add({
      id: generateId("log"),
      level: "success",
      source: "wraith",
      message: `[wraith] ${fullText}`,
      timestamp: new Date().toISOString(),
    });

    if (action?.type === "integration" && action.target) {
      store.logs.add({
        id: generateId("log"),
        level: "info",
        source: action.target.toLowerCase(),
        message: `[${action.target}] ${action.result}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Send done event
    res.write(
      `data: ${JSON.stringify({
        type: "done",
        id: responseId,
        action,
        fullText,
        timestamp: savedResponse.timestamp,
      })}\n\n`,
    );
  } catch (err) {
    console.error("[wraith] Stream error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to generate response" })}\n\n`);
  }

  res.end();
};

export const handleCommandGet: RequestHandler = (_req, res) => {
  const commands = store.commands.getAll();
  res.status(200).json(commands);
};

/** Clear conversation history for a user */
export const handleCommandClear: RequestHandler = (req, res) => {
  const { userId = "default" } = req.body as { userId?: string };
  _conversationHistory.delete(userId);
  res.status(200).json({ message: "Conversation cleared" });
};
