import { RequestHandler } from "express";
import { store, generateId } from "../store.js";
import { strParam } from "../lib/utils.js";
import type { Automation, AutomationCreateRequest } from "@shared/api";

// GET /api/automations — list all
export const handleAutomationsList: RequestHandler = (_req, res) => {
  const automations = store.automations.getAll();
  res.status(200).json(automations);
};

// POST /api/automations — create
export const handleAutomationsCreate: RequestHandler = (req, res) => {
  const { name, trigger, integrationId } = req.body as AutomationCreateRequest;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Automation name is required" });
    return;
  }
  if (!trigger || typeof trigger !== "string" || trigger.trim().length === 0) {
    res.status(400).json({ error: "Automation trigger is required" });
    return;
  }

  const now = new Date().toISOString();
  const automation: Automation = {
    id: generateId("auto"),
    name: name.trim(),
    trigger: trigger.trim(),
    active: true,
    integrationId,
    createdAt: now,
    updatedAt: now,
  };

  store.automations.create(automation);

  store.logs.add({
    id: generateId("log"),
    level: "success",
    source: "system",
    message: `[automation] created "${automation.name}" — ${automation.trigger}`,
    timestamp: now,
  });

  res.status(201).json(automation);
};

// PATCH /api/automations/:id/toggle — toggle active state
export const handleAutomationsToggle: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const { active } = req.body as { active: boolean };

  const existing = store.automations.getById(id);
  if (!existing) {
    res.status(404).json({ error: "Automation not found" });
    return;
  }

  const updated = store.automations.update(id, { active });

  store.logs.add({
    id: generateId("log"),
    level: active ? "success" : "warning",
    source: "system",
    message: `[automation] ${active ? "activated" : "deactivated"} "${existing.name}"`,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json(updated);
};

// DELETE /api/automations/:id — delete
export const handleAutomationsDelete: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);

  const existing = store.automations.getById(id);
  if (!existing) {
    res.status(404).json({ error: "Automation not found" });
    return;
  }

  store.automations.delete(id);

  store.logs.add({
    id: generateId("log"),
    level: "warning",
    source: "system",
    message: `[automation] deleted "${existing.name}"`,
    timestamp: new Date().toISOString(),
  });

  res.status(204).send();
};
