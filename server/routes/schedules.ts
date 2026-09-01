import { RequestHandler } from "express";
import { scheduler } from "../lib/scheduler.js";
import { strParam } from "../lib/utils.js";

/**
 * POST /api/schedules — create a new schedule
 */
export const handleSchedulesCreate: RequestHandler = (req, res) => {
  const { workflowId, name, triggerType, triggerConfig, enabled } = req.body as {
    workflowId?: string;
    name?: string;
    triggerType?: string;
    triggerConfig?: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!name || !triggerType || !triggerConfig) {
    res.status(400).json({ error: "name, triggerType, and triggerConfig are required" });
    return;
  }

  const schedule = scheduler.create({
    workflowId,
    name,
    triggerType: triggerType as any,
    triggerConfig,
    enabled,
  });

  res.status(201).json(schedule);
};

/**
 * GET /api/schedules — list all schedules
 */
export const handleSchedulesList: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const schedules = scheduler.getAll(limit);
  res.status(200).json({ schedules, total: schedules.length });
};

/**
 * GET /api/schedules/:id — get a schedule
 */
export const handleSchedulesGet: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const schedule = scheduler.getById(id);

  if (!schedule) {
    res.status(404).json({ error: `Schedule "${id}" not found` });
    return;
  }

  res.status(200).json(schedule);
};

/**
 * PUT /api/schedules/:id — update a schedule
 */
export const handleSchedulesUpdate: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const patch = req.body;

  const schedule = scheduler.update(id, patch);
  if (!schedule) {
    res.status(404).json({ error: `Schedule "${id}" not found` });
    return;
  }

  res.status(200).json(schedule);
};

/**
 * DELETE /api/schedules/:id — delete a schedule
 */
export const handleSchedulesDelete: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const deleted = scheduler.delete(id);

  if (!deleted) {
    res.status(404).json({ error: `Schedule "${id}" not found` });
    return;
  }

  res.status(200).json({ message: "Schedule deleted", id });
};

/**
 * POST /api/schedules/:id/toggle — enable/disable
 */
export const handleSchedulesToggle: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const schedule = scheduler.toggle(id);

  if (!schedule) {
    res.status(404).json({ error: `Schedule "${id}" not found` });
    return;
  }

  res.status(200).json(schedule);
};

/**
 * POST /api/schedules/:id/run — manually trigger a schedule
 */
export const handleSchedulesRun: RequestHandler = async (req, res) => {
  const id = strParam(req.params.id);

  try {
    const result = await scheduler.execute(id);
    res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error });
  }
};
