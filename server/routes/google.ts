import { RequestHandler } from "express";
import { googleConnector } from "../lib/google.js";

/**
 * GET /api/google/status — check connection status
 */
export const handleGoogleStatus: RequestHandler = (_req, res) => {
  const status = googleConnector.getStatus();
  res.status(200).json(status);
};

/**
 * GET /api/google/auth-url — get OAuth authorization URL
 */
export const handleGoogleAuthUrl: RequestHandler = (_req, res) => {
  const url = googleConnector.getAuthUrl();
  res.status(200).json({ url });
};

/**
 * GET /api/google/callback — OAuth callback handler
 */
export const handleGoogleCallback: RequestHandler = async (req, res) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  const result = await googleConnector.handleCallback(code);

  if (result.success) {
    // Redirect to frontend with success
    res.redirect(`/?google=connected&email=${encodeURIComponent(result.email || "")}`);
  } else {
    res.redirect(`/?google=error&message=${encodeURIComponent(result.error || "Unknown error")}`);
  }
};

/**
 * POST /api/google/disconnect — disconnect Google
 */
export const handleGoogleDisconnect: RequestHandler = async (_req, res) => {
  const success = await googleConnector.disconnect();
  res.status(200).json({ success, message: success ? "Disconnected" : "Not connected" });
};

// ── Gmail ─────────────────────────────────────────────────────

/**
 * GET /api/google/gmail/messages — list messages
 */
export const handleGmailList: RequestHandler = async (req, res) => {
  const query = (req.query.q as string) || "";
  const maxResults = req.query.max ? parseInt(req.query.max as string, 10) : 10;

  try {
    const result = await googleConnector.gmailListMessages("default", query, maxResults);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/google/gmail/messages/:id — read a message
 */
export const handleGmailRead: RequestHandler = async (req, res) => {
  const messageId = req.params.id as string;

  try {
    const result = await googleConnector.gmailReadMessage("default", messageId);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Calendar ──────────────────────────────────────────────────

/**
 * GET /api/google/calendar/events — list upcoming events
 */
export const handleCalendarList: RequestHandler = async (req, res) => {
  const timeMin = req.query.timeMin as string | undefined;
  const timeMax = req.query.timeMax as string | undefined;
  const maxResults = req.query.max ? parseInt(req.query.max as string, 10) : 10;

  try {
    const result = await googleConnector.calendarListEvents("default", timeMin, timeMax, maxResults);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Drive ─────────────────────────────────────────────────────

/**
 * GET /api/google/drive/files — list files
 */
export const handleDriveList: RequestHandler = async (req, res) => {
  const query = (req.query.q as string) || "";
  const maxResults = req.query.max ? parseInt(req.query.max as string, 10) : 10;

  try {
    const result = await googleConnector.driveListFiles("default", query, maxResults);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Docs ──────────────────────────────────────────────────────

/**
 * GET /api/google/docs/:id — read a document
 */
export const handleDocsRead: RequestHandler = async (req, res) => {
  const documentId = req.params.id as string;

  try {
    const result = await googleConnector.docsReadDocument("default", documentId);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Sheets ────────────────────────────────────────────────────

/**
 * GET /api/google/sheets/:id — read a spreadsheet
 */
export const handleSheetsRead: RequestHandler = async (req, res) => {
  const spreadsheetId = req.params.id as string;
  const range = (req.query.range as string) || "Sheet1!A1:Z100";

  try {
    const result = await googleConnector.sheetsReadSpreadsheet("default", spreadsheetId, range);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
