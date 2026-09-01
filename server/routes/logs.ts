import { RequestHandler } from "express";
import { store, generateId } from "../store.js";
import type { LogCreateRequest } from "@shared/api";

// GET /api/logs — list all logs (newest first)
export const handleLogsList: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const logs = store.logs.getAll(limit);
  res.status(200).json(logs);
};

// POST /api/logs — create a new log entry
export const handleLogsCreate: RequestHandler = (req, res) => {
  const { level, source, message } = req.body as LogCreateRequest;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Log message is required" });
    return;
  }

  const entry = store.logs.add({
    id: generateId("log"),
    level: level || "info",
    source: source || "system",
    message: message.trim(),
    timestamp: new Date().toISOString(),
  });

  res.status(201).json(entry);
};

// DELETE /api/logs — clear all logs
export const handleLogsClear: RequestHandler = (_req, res) => {
  store.logs.clear();
  res.status(200).json({ message: "Logs cleared" });
};
