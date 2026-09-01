import { RequestHandler } from "express";
import { store, generateId } from "../store.js";
import type { WraithSettings } from "@shared/api";

// GET /api/settings — get current settings
export const handleSettingsGet: RequestHandler = (_req, res) => {
  const settings = store.settings.get();
  res.status(200).json(settings);
};

// PUT /api/settings — update settings (partial merge)
export const handleSettingsUpdate: RequestHandler = (req, res) => {
  const patch = req.body as Partial<WraithSettings>;

  if (!patch || typeof patch !== "object") {
    res.status(400).json({ error: "Settings object is required" });
    return;
  }

  const updated = store.settings.update(patch);

  store.logs.add({
    id: generateId("log"),
    level: "info",
    source: "system",
    message: "[settings] configuration updated",
    timestamp: new Date().toISOString(),
  });

  res.status(200).json(updated);
};
