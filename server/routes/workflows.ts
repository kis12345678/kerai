import { RequestHandler } from "express";
import { workflowEngine } from "../lib/workflows.js";
import { strParam } from "../lib/utils.js";

/**
 * POST /api/workflows — create a new workflow
 */
export const handleWorkflowsCreate: RequestHandler = (req, res) => {
  const { name, description, triggerType, triggerConfig, steps, conditions, enabled } = req.body as {
    name?: string;
    description?: string;
    triggerType?: string;
    triggerConfig?: Record<string, unknown>;
    steps?: any[];
    conditions?: any[];
    enabled?: boolean;
  };

  if (!name || !steps || !Array.isArray(steps)) {
    res.status(400).json({ error: "name and steps (array) are required" });
    return;
  }

  const workflow = workflowEngine.create({
    name,
    description,
    triggerType: triggerType as any,
    triggerConfig,
    steps,
    conditions,
    enabled,
  });

  res.status(201).json(workflow);
};

/**
 * GET /api/workflows — list all workflows
 */
export const handleWorkflowsList: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const workflows = workflowEngine.getAll(limit);
  res.status(200).json({ workflows, total: workflows.length });
};

/**
 * GET /api/workflows/:id — get a workflow
 */
export const handleWorkflowsGet: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const workflow = workflowEngine.getById(id);

  if (!workflow) {
    res.status(404).json({ error: `Workflow "${id}" not found` });
    return;
  }

  res.status(200).json(workflow);
};

/**
 * PUT /api/workflows/:id — update a workflow
 */
export const handleWorkflowsUpdate: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const patch = req.body;

  const workflow = workflowEngine.update(id, patch);
  if (!workflow) {
    res.status(404).json({ error: `Workflow "${id}" not found` });
    return;
  }

  res.status(200).json(workflow);
};

/**
 * DELETE /api/workflows/:id — delete a workflow
 */
export const handleWorkflowsDelete: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const deleted = workflowEngine.delete(id);

  if (!deleted) {
    res.status(404).json({ error: `Workflow "${id}" not found` });
    return;
  }

  res.status(200).json({ message: "Workflow deleted", id });
};

/**
 * POST /api/workflows/:id/toggle — enable/disable a workflow
 */
export const handleWorkflowsToggle: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const workflow = workflowEngine.toggle(id);

  if (!workflow) {
    res.status(404).json({ error: `Workflow "${id}" not found` });
    return;
  }

  res.status(200).json(workflow);
};

/**
 * POST /api/workflows/:id/run — execute a workflow
 */
export const handleWorkflowsRun: RequestHandler = async (req, res) => {
  const id = strParam(req.params.id);

  try {
    const result = await workflowEngine.execute(id);
    res.status(200).json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error });
  }
};
