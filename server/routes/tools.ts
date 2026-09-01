import { RequestHandler } from "express";
import { toolRegistry } from "../lib/registry.js";
import { eventBus } from "../lib/events.js";
import { strParam } from "../lib/utils.js";
import type { ToolCategory } from "@shared/api";

/**
 * GET /api/tools — list all registered tools
 */
export const handleToolsList: RequestHandler = (req, res) => {
  const category = req.query.category as ToolCategory | undefined;
  const provider = req.query.provider as string | undefined;

  let tools = toolRegistry.getAll();

  if (category) {
    tools = tools.filter((t) => t.category === category);
  }
  if (provider) {
    tools = tools.filter((t) => t.provider === provider);
  }

  // Group by category
  const byCategory: Record<string, number> = {};
  for (const tool of tools) {
    byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
  }

  res.status(200).json({
    tools,
    total: tools.length,
    byCategory,
  });
};

/**
 * GET /api/tools/:name — get a specific tool
 */
export const handleToolsGet: RequestHandler = (req, res) => {
  const name = strParam(req.params.name);
  const tool = toolRegistry.get(name);

  if (!tool) {
    res.status(404).json({ error: `Tool "${name}" not found` });
    return;
  }

  res.status(200).json(tool);
};

/**
 * POST /api/tools/:name/execute — execute a tool
 */
export const handleToolsExecute: RequestHandler = async (req, res) => {
  const name = strParam(req.params.name);
  const input = req.body?.input || {};

  if (!toolRegistry.isAvailable(name)) {
    res.status(404).json({ error: `Tool "${name}" not found or disabled` });
    return;
  }

  const tool = toolRegistry.get(name)!;
  if (tool.requiresConfirmation) {
    const confirmed = req.body?.confirmed;
    if (!confirmed) {
      res.status(409).json({
        error: `Tool "${name}" requires confirmation`,
        tool,
        message: "Re-send with confirmed: true to proceed",
      });
      return;
    }
  }

  const result = await toolRegistry.execute(name, input);
  res.status(result.success ? 200 : 500).json(result);
};

/**
 * PATCH /api/tools/:name — enable/disable a tool
 */
export const handleToolsToggle: RequestHandler = (req, res) => {
  const name = strParam(req.params.name);
  const { enabled } = req.body as { enabled?: boolean };

  if (enabled === undefined) {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }

  toolRegistry.setEnabled(name, enabled);
  const tool = toolRegistry.get(name);

  if (!tool) {
    res.status(404).json({ error: `Tool "${name}" not found` });
    return;
  }

  res.status(200).json(tool);
};

/**
 * GET /api/tools/runs — get recent tool execution history
 */
export const handleToolsRuns: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const runs = toolRegistry.getRecentRuns(limit);
  res.status(200).json({ runs, total: runs.length });
};
