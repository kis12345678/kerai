import { RequestHandler } from "express";
import { eventBus } from "../lib/events.js";
import type { KeraiEventType, KeraiEvent } from "@shared/api";

/**
 * GET /api/events — query persisted events
 */
export const handleEventsList: RequestHandler = (req, res) => {
  const type = req.query.type as KeraiEventType | undefined;
  const source = req.query.source as string | undefined;
  const severity = req.query.severity as KeraiEvent["severity"] | undefined;
  const since = req.query.since as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const recent = req.query.recent === "true";

  if (recent) {
    // Get from in-memory buffer (faster)
    const events = eventBus.getRecent(limit);
    res.status(200).json({ events, total: events.length, source: "buffer" });
    return;
  }

  const events = eventBus.query({ type, source, severity, since, limit });
  res.status(200).json({ events, total: events.length, source: "database" });
};

/**
 * GET /api/events/recent — get recent events from memory buffer
 */
export const handleEventsRecent: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const events = eventBus.getRecent(limit);
  res.status(200).json({ events, total: events.length });
};

/**
 * GET /api/events/stats — get event statistics
 */
export const handleEventsStats: RequestHandler = (_req, res) => {
  const recent = eventBus.getRecent(200);

  // Count by type
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const event of recent) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    bySource[event.source] = (bySource[event.source] || 0) + 1;
    bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
  }

  res.status(200).json({
    total: recent.length,
    byType,
    bySource,
    bySeverity,
    providers: eventBus.getRecent(1).length > 0 ? "active" : "idle",
  });
};
