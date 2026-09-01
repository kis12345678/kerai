import { google } from "googleapis";
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import { run, queryOne, queryAll } from "./db.js";
import { eventBus } from "./events.js";
import crypto from "node:crypto";

// ── Config ─────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:8080/api/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// ── Token Storage ──────────────────────────────────────────────

interface StoredToken {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  email: string;
  name: string;
  picture: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

function storeToken(data: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  email: string;
  name: string;
  picture: string;
  scope: string;
}): StoredToken {
  const now = new Date().toISOString();
  const id = `gtoken-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // Upsert: delete existing token for this user, insert new
  run(`DELETE FROM audit_log WHERE entity_type = 'google_token' AND entity_id = ?`, data.userId);

  run(
    `INSERT INTO audit_log (id, action, entity_type, entity_id, actor, details, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    "google.token.store",
    "google_token",
    data.userId,
    "google-oauth",
    JSON.stringify({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiryDate: data.expiryDate,
      email: data.email,
      name: data.name,
      picture: data.picture,
      scope: data.scope,
    }),
    now,
  );

  return {
    id,
    userId: data.userId,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiryDate: data.expiryDate,
    email: data.email,
    name: data.name,
    picture: data.picture,
    scope: data.scope,
    createdAt: now,
    updatedAt: now,
  };
}

function getStoredToken(userId: string = "default"): { tokens: StoredToken; details: any } | null {
  const row = queryOne<{ details: string; timestamp: string }>(
    `SELECT details, timestamp FROM audit_log
     WHERE entity_type = 'google_token' AND entity_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    userId,
  );

  if (!row) return null;

  const details = JSON.parse(row.details);
  return {
    tokens: {
      id: "token",
      userId,
      accessToken: details.accessToken,
      refreshToken: details.refreshToken,
      expiryDate: details.expiryDate,
      email: details.email,
      name: details.name,
      picture: details.picture,
      scope: details.scope,
      createdAt: row.timestamp,
      updatedAt: row.timestamp,
    },
    details,
  };
}

// ── OAuth2 Client ──────────────────────────────────────────────

function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );
}

/**
 * Get a Google OAuth2 client for API calls.
 * Refreshes token if expired.
 */
async function getAuthenticatedClient(userId: string = "default"): Promise<OAuth2Client | null> {
  const stored = getStoredToken(userId);
  if (!stored) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: stored.details.accessToken,
    refresh_token: stored.details.refreshToken,
    expiry_date: stored.details.expiryDate,
  });

  // Check if token needs refresh
  if (stored.details.expiryDate < Date.now() + 60000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Update stored token
      if (credentials.access_token && credentials.refresh_token) {
        storeToken({
          userId,
          accessToken: credentials.access_token,
          refreshToken: credentials.refresh_token,
          expiryDate: credentials.expiry_date || Date.now() + 3600000,
          email: stored.details.email,
          name: stored.details.name,
          picture: stored.details.picture,
          scope: stored.details.scope,
        });
      }
    } catch (err) {
      console.error("[google] Token refresh failed:", err);
      eventBus.emit("connector.error", "google", { error: "Token refresh failed" }, "error");
      return null;
    }
  }

  return oauth2Client;
}

// ── Google Connector ───────────────────────────────────────────

/**
 * KERAI Google Connector
 *
 * Provides access to Google services:
 * - Gmail (read, send, search)
 * - Calendar (list, create, update events)
 * - Drive (search, list, download)
 * - Docs (read documents)
 * - Sheets (read spreadsheets)
 *
 * Uses OAuth2 with automatic token refresh.
 */
class GoogleConnector {
  /**
   * Get the OAuth authorization URL
   */
  getAuthUrl(): string {
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(code: string, userId: string = "default"): Promise<{
    success: boolean;
    email?: string;
    name?: string;
    error?: string;
  }> {
    try {
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        return { success: false, error: "Missing tokens in response" };
      }

      // Get user info
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      // Store token
      storeToken({
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date || Date.now() + 3600000,
        email: userInfo.data.email || "",
        name: userInfo.data.name || "",
        picture: userInfo.data.picture || "",
        scope: tokens.scope || SCOPES.join(" "),
      });

      eventBus.emit("connector.connected", "google", {
        email: userInfo.data.email,
        name: userInfo.data.name,
      });

      console.log(`[google] ✅ Connected: ${userInfo.data.email}`);

      return {
        success: true,
        email: userInfo.data.email || undefined,
        name: userInfo.data.name || undefined,
      };
    } catch (err: any) {
      console.error("[google] OAuth callback failed:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if Google is connected
   */
  isConnected(userId: string = "default"): boolean {
    return getStoredToken(userId) !== null;
  }

  /**
   * Get connection status
   */
  getStatus(userId: string = "default"): {
    connected: boolean;
    email?: string;
    name?: string;
    picture?: string;
    scopes?: string[];
  } {
    const stored = getStoredToken(userId);
    if (!stored) return { connected: false };

    return {
      connected: true,
      email: stored.details.email,
      name: stored.details.name,
      picture: stored.details.picture,
      scopes: stored.details.scope?.split(" ") || [],
    };
  }

  /**
   * Disconnect (revoke tokens)
   */
  async disconnect(userId: string = "default"): Promise<boolean> {
    const stored = getStoredToken(userId);
    if (!stored) return false;

    try {
      // Try to revoke the token
      const oauth2Client = createOAuth2Client();
      await oauth2Client.revokeToken(stored.details.accessToken);
    } catch {}

    // Delete from storage
    run(
      `DELETE FROM audit_log WHERE entity_type = 'google_token' AND entity_id = ?`,
      userId,
    );

    eventBus.emit("connector.disconnected", "google", { userId });
    console.log(`[google] 🔌 Disconnected: ${stored.details.email}`);
    return true;
  }

  // ── Gmail ─────────────────────────────────────────────────

  async gmailListMessages(userId: string = "default", query: string = "", maxResults: number = 10) {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    const messages = res.data.messages || [];
    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "metadata" });
        const headers = msg.data.payload?.headers || [];
        return {
          id: m.id,
          snippet: msg.data.snippet,
          subject: headers.find((h) => h.name === "Subject")?.value || "",
          from: headers.find((h) => h.name === "From")?.value || "",
          date: headers.find((h) => h.name === "Date")?.value || "",
        };
      }),
    );

    return { messages: details, total: res.data.resultSizeEstimate || 0 };
  }

  async gmailReadMessage(userId: string = "default", messageId: string) {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const gmail = google.gmail({ version: "v1", auth: client });
    const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });

    const headers = msg.data.payload?.headers || [];
    const body = extractBody(msg.data.payload);

    return {
      id: msg.data.id,
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      body,
      snippet: msg.data.snippet,
    };
  }

  // ── Calendar ──────────────────────────────────────────────

  async calendarListEvents(userId: string = "default", timeMin?: string, timeMax?: string, maxResults: number = 10) {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin || new Date().toISOString(),
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    return {
      events: (res.data.items || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        description: e.description,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        htmlLink: e.htmlLink,
        status: e.status,
      })),
      total: res.data.items?.length || 0,
    };
  }

  // ── Drive ─────────────────────────────────────────────────

  async driveListFiles(userId: string = "default", query: string = "", maxResults: number = 10) {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const drive = google.drive({ version: "v3", auth: client });
    const res = await drive.files.list({
      q: query || "trashed = false",
      pageSize: maxResults,
      fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, parents)",
      orderBy: "modifiedTime desc",
    });

    return {
      files: (res.data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? parseInt(f.size) : 0,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      })),
      total: res.data.files?.length || 0,
    };
  }

  // ── Docs ──────────────────────────────────────────────────

  async docsReadDocument(userId: string = "default", documentId: string) {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const docs = google.docs({ version: "v1", auth: client });
    const doc = await docs.documents.get({ documentId });

    const body = doc.data.body?.content || [];
    const text = body
      .map((element) => {
        if (element.paragraph) {
          return element.paragraph.elements?.map((e) => e.textRun?.content || "").join("") || "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    return {
      documentId: doc.data.documentId,
      title: doc.data.title,
      text,
    };
  }

  // ── Sheets ────────────────────────────────────────────────

  async sheetsReadSpreadsheet(userId: string = "default", spreadsheetId: string, range: string = "Sheet1!A1:Z100") {
    const client = await getAuthenticatedClient(userId);
    if (!client) throw new Error("Google not connected");

    const sheets = google.sheets({ version: "v4", auth: client });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return {
      spreadsheetId,
      range: res.data.range,
      values: res.data.values || [],
      rowCount: res.data.values?.length || 0,
    };
  }
}

export const googleConnector = new GoogleConnector();

// ── Helpers ────────────────────────────────────────────────────

function extractBody(payload: any): string {
  if (!payload) return "";

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    // Fallback to HTML
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
  }

  return "";
}
