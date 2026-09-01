import { RequestHandler } from "express";
import { microsoftConnector } from "../lib/microsoft.js";

/**
 * GET /api/microsoft/status — connection status
 */
export const handleMicrosoftStatus: RequestHandler = (_req, res) => {
  const status = microsoftConnector.getStatus();
  res.status(200).json(status);
};

/**
 * GET /api/microsoft/auth-url — get OAuth URL
 */
export const handleMicrosoftAuthUrl: RequestHandler = async (_req, res) => {
  const url = await microsoftConnector.getAuthUrl();
  if (!url) {
    res.status(503).json({ error: "Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in .env" });
    return;
  }
  res.status(200).json({ url });
};

/**
 * GET /api/microsoft/callback — OAuth callback
 */
export const handleMicrosoftCallback: RequestHandler = async (req, res) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  const result = await microsoftConnector.handleCallback(code);

  if (result.success) {
    res.redirect(`/?microsoft=connected&email=${encodeURIComponent(result.email || "")}`);
  } else {
    res.redirect(`/?microsoft=error&message=${encodeURIComponent(result.error || "Unknown error")}`);
  }
};

/**
 * POST /api/microsoft/disconnect
 */
export const handleMicrosoftDisconnect: RequestHandler = (_req, res) => {
  const success = microsoftConnector.disconnect();
  res.status(200).json({ success, message: success ? "Disconnected" : "Not connected" });
};

// ── Outlook ────────────────────────────────────────────────────

/**
 * GET /api/microsoft/outlook/messages
 */
export const handleOutlookList: RequestHandler = async (req, res) => {
  const filter = (req.query.filter as string) || "";
  const top = req.query.top ? parseInt(req.query.top as string, 10) : 10;

  try {
    const result = await microsoftConnector.outlookListMessages("default", filter, top);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/microsoft/outlook/messages/:id
 */
export const handleOutlookRead: RequestHandler = async (req, res) => {
  const messageId = req.params.id as string;

  try {
    const result = await microsoftConnector.outlookReadMessage("default", messageId);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Calendar ──────────────────────────────────────────────────

/**
 * GET /api/microsoft/calendar/events
 */
export const handleMicrosoftCalendarList: RequestHandler = async (req, res) => {
  const top = req.query.top ? parseInt(req.query.top as string, 10) : 10;

  try {
    const result = await microsoftConnector.calendarListEvents("default", top);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── OneDrive ──────────────────────────────────────────────────

/**
 * GET /api/microsoft/onedrive/files
 */
export const handleOneDriveList: RequestHandler = async (req, res) => {
  const folder = (req.query.folder as string) || "root";
  const top = req.query.top ? parseInt(req.query.top as string, 10) : 20;

  try {
    const result = await microsoftConnector.onedriveListFiles("default", folder, top);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Excel ─────────────────────────────────────────────────────

/**
 * GET /api/microsoft/excel/:fileId
 */
export const handleExcelRead: RequestHandler = async (req, res) => {
  const fileId = req.params.fileId as string;
  const sheet = (req.query.sheet as string) || "Sheet1";
  const range = (req.query.range as string) || "A1:Z100";

  try {
    const result = await microsoftConnector.excelReadSheet("default", fileId, sheet, range);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Teams ─────────────────────────────────────────────────────

/**
 * GET /api/microsoft/teams
 */
export const handleTeamsList: RequestHandler = async (req, res) => {
  const teamId = req.query.teamId as string | undefined;
  const channelId = req.query.channelId as string | undefined;
  const top = req.query.top ? parseInt(req.query.top as string, 10) : 20;

  try {
    const result = await microsoftConnector.teamsListMessages("default", teamId, channelId, top);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
