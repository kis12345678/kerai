import { RequestHandler } from "express";
import { taskEngine } from "../lib/tasks.js";
import { strParam } from "../lib/utils.js";

/**
 * POST /api/tasks — execute a new task from a user message
 */
export const handleTasksExecute: RequestHandler = async (req, res) => {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const result = await taskEngine.execute(message.trim());
    res.status(200).json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[tasks] Execution failed:", error);
    res.status(500).json({ error: "Task execution failed", details: error });
  }
};

/**
 * GET /api/tasks — list all tasks
 */
export const handleTasksList: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const tasks = taskEngine.getAll(limit);
  const stats = taskEngine.getStats();
  res.status(200).json({ tasks, ...stats });
};

/**
 * GET /api/tasks/:id — get a specific task
 */
export const handleTasksGet: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const task = taskEngine.getById(id);

  if (!task) {
    res.status(404).json({ error: `Task "${id}" not found` });
    return;
  }

  res.status(200).json(task);
};

/**
 * POST /api/tasks/:id/cancel — cancel a running task
 */
export const handleTasksCancel: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const cancelled = taskEngine.cancel(id);

  if (!cancelled) {
    res.status(404).json({ error: `Task "${id}" not found or already completed` });
    return;
  }

  res.status(200).json({ message: "Task cancelled", id });
};

/**
 * GET /api/tasks/stats — get task statistics
 */
export const handleTasksStats: RequestHandler = (_req, res) => {
  const stats = taskEngine.getStats();
  res.status(200).json(stats);
};
