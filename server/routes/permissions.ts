import { RequestHandler } from "express";
import { permissions } from "../lib/permissions.js";

/**
 * GET /api/permissions — get current permission status
 */
export const handlePermissionsStatus: RequestHandler = (_req, res) => {
  const status = permissions.getStatus();
  res.status(200).json(status);
};

/**
 * GET /api/permissions/check/:toolName — check if a specific tool is authorized
 */
export const handlePermissionsCheck: RequestHandler = (req, res) => {
  const toolName = req.params.toolName as string;
  if (!toolName) {
    res.status(400).json({ error: "toolName is required" });
    return;
  }

  const check = permissions.check(toolName);
  res.status(200).json(check);
};

/**
 * POST /api/permissions/override — create a permission override
 */
export const handlePermissionsOverride: RequestHandler = (req, res) => {
  const { toolName, allowed, reason, expiresMinutes } = req.body as {
    toolName?: string;
    allowed?: boolean;
    reason?: string;
    expiresMinutes?: number;
  };

  if (!toolName || allowed === undefined || !reason) {
    res.status(400).json({ error: "toolName, allowed, and reason are required" });
    return;
  }

  permissions.setOverride(toolName, allowed, reason, expiresMinutes);
  res.status(200).json({ message: `Override set for ${toolName}: ${allowed ? "allow" : "block"}` });
};

/**
 * DELETE /api/permissions/override/:toolName — remove a permission override
 */
export const handlePermissionsClearOverride: RequestHandler = (req, res) => {
  const toolName = req.params.toolName as string;
  permissions.clearOverride(toolName);
  res.status(200).json({ message: `Override cleared for ${toolName}` });
};

/**
 * GET /api/permissions/overrides — list all active overrides
 */
export const handlePermissionsOverrides: RequestHandler = (_req, res) => {
  const overrides = permissions.getOverrides();
  res.status(200).json({ overrides, total: overrides.length });
};

/**
 * GET /api/permissions/audit — get permission audit log
 */
export const handlePermissionsAudit: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const log = permissions.getAuditLog(limit);
  res.status(200).json({ entries: log, total: log.length });
};
