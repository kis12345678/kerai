import { RequestHandler } from "express";
import { store, generateId } from "../store.js";
import { strParam } from "../lib/utils.js";
import type { IntegrationToggleRequest } from "@shared/api";

// GET /api/integrations — list all
export const handleIntegrationsList: RequestHandler = (_req, res) => {
  const integrations = store.integrations.getAll();
  res.status(200).json(integrations);
};

// GET /api/integrations/:id — get one
export const handleIntegrationsGet: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const integration = store.integrations.getById(id);

  if (!integration) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  res.status(200).json(integration);
};

// PATCH /api/integrations/:id — update status
export const handleIntegrationsUpdate: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const { status } = req.body as IntegrationToggleRequest;

  const existing = store.integrations.getById(id);
  if (!existing) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  if (!status) {
    res.status(400).json({ error: "Status is required" });
    return;
  }

  const updated = store.integrations.update(id, { status });

  store.logs.add({
    id: generateId("log"),
    level: status === "connected" ? "success" : status === "error" ? "error" : "info",
    source: existing.name.toLowerCase(),
    message: `[${existing.name}] status changed to ${status}`,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json(updated);
};

// POST /api/integrations/:id/sync — trigger a sync
export const handleIntegrationsSync: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);

  const existing = store.integrations.getById(id);
  if (!existing) {
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  if (existing.status !== "connected") {
    res.status(400).json({ error: "Integration is not connected" });
    return;
  }

  const updated = store.integrations.update(id, { lastSyncedAt: new Date().toISOString() });

  store.logs.add({
    id: generateId("log"),
    level: "success",
    source: existing.name.toLowerCase(),
    message: `[${existing.name}] manual sync completed`,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json(updated);
};
