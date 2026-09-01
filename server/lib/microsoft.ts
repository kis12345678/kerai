import { ConfidentialClientApplication, type AuthenticationResult } from "@azure/msal-node";
import { run, queryOne } from "./db.js";
import { eventBus } from "./events.js";
import crypto from "node:crypto";

// ── Config ─────────────────────────────────────────────────────

const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MS_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";
const MS_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || "http://localhost:8080/api/microsoft/callback";

const SCOPES = [
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Mail.ReadWrite",
  "Calendars.Read",
  "Calendars.ReadWrite",
  "Files.Read",
  "Files.ReadWrite",
  "Sites.Read.All",
  "Team.ReadBasic.All",
  "ChannelMessage.Read.All",
  "offline_access",
];

// ── MSAL Client ────────────────────────────────────────────────

function getMsalClient(): ConfidentialClientApplication | null {
  if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) return null;

  return new ConfidentialClientApplication({
    auth: {
      clientId: MS_CLIENT_ID,
      clientSecret: MS_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${MS_TENANT_ID}`,
    },
  });
}

// ── Token Storage ──────────────────────────────────────────────

function storeToken(data: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  name: string;
}): void {
  const now = new Date().toISOString();

  run(
    `INSERT INTO audit_log (id, action, entity_type, entity_id, actor, details, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `mstoken-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    "microsoft.token.store",
    "microsoft_token",
    data.userId,
    "microsoft-oauth",
    JSON.stringify({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      email: data.email,
      name: data.name,
    }),
    now,
  );
}

function getStoredToken(userId: string = "default"): { accessToken: string; refreshToken: string; expiresAt: number; email: string; name: string } | null {
  const row = queryOne<{ details: string }>(
    `SELECT details FROM audit_log
     WHERE entity_type = 'microsoft_token' AND entity_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    userId,
  );

  if (!row) return null;
  return JSON.parse(row.details);
}

// ── Microsoft Connector ────────────────────────────────────────

class MicrosoftConnector {
  /**
   * Get the OAuth authorization URL
   */
  async getAuthUrl(): Promise<string | null> {
    const msal = getMsalClient();
    if (!msal) return null;

    return msal.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: MS_REDIRECT_URI,
    });
  }

  /**
   * Exchange code for tokens
   */
  async handleCallback(code: string, userId: string = "default"): Promise<{
    success: boolean;
    email?: string;
    name?: string;
    error?: string;
  }> {
    const msal = getMsalClient();
    if (!msal) return { success: false, error: "Microsoft OAuth not configured" };

    try {
      const result: AuthenticationResult = await msal.acquireTokenByCode({
        code,
        scopes: SCOPES,
        redirectUri: MS_REDIRECT_URI,
      });

      if (!result.accessToken || !result.account) {
        return { success: false, error: "Missing tokens in response" };
      }

      const expiresAt = result.expiresOn?.getTime() || Date.now() + 3600000;
      storeToken({
          userId,
          accessToken: result.accessToken,
          refreshToken: (result as any).refreshToken || "",
        expiresAt,
        email: result.account.username || "",
        name: result.account.name || "",
      });

      eventBus.emit("connector.connected", "microsoft", {
        email: result.account.username,
        name: result.account.name,
      });

      console.log(`[microsoft] ✅ Connected: ${result.account.username}`);

      return {
        success: true,
        email: result.account.username,
        name: result.account.name,
      };
    } catch (err: any) {
      console.error("[microsoft] OAuth callback failed:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if Microsoft is connected
   */
  isConnected(userId: string = "default"): boolean {
    const token = getStoredToken(userId);
    if (!token) return false;
    // Check if expired
    return token.expiresAt > Date.now();
  }

  /**
   * Get connection status
   */
  getStatus(userId: string = "default"): {
    connected: boolean;
    email?: string;
    name?: string;
  } {
    const token = getStoredToken(userId);
    if (!token) return { connected: false };

    return {
      connected: token.expiresAt > Date.now(),
      email: token.email,
      name: token.name,
    };
  }

  /**
   * Disconnect
   */
  disconnect(userId: string = "default"): boolean {
    run(`DELETE FROM audit_log WHERE entity_type = 'microsoft_token' AND entity_id = ?`, userId);
    eventBus.emit("connector.disconnected", "microsoft", { userId });
    console.log(`[microsoft] 🔌 Disconnected`);
    return true;
  }

  /**
   * Get a valid access token (refresh if needed)
   */
  private async getAccessToken(userId: string = "default"): Promise<string | null> {
    const token = getStoredToken(userId);
    if (!token) return null;

    // If token is still valid (with 5min buffer), use it
    if (token.expiresAt > Date.now() + 300000) {
      return token.accessToken;
    }

    // Try to refresh
    const msal = getMsalClient();
    if (!msal || !token.refreshToken) return null;

    try {
      const result = await msal.acquireTokenByRefreshToken({
        refreshToken: token.refreshToken,
        scopes: SCOPES,
      });

      if (result?.accessToken) {
        storeToken({
          userId,
          accessToken: result.accessToken,
          refreshToken: (result as any).refreshToken || token.refreshToken,
          expiresAt: result.expiresOn?.getTime() || Date.now() + 3600000,
          email: result.account?.username || token.email,
          name: result.account?.name || token.name,
        });
        return result.accessToken;
      }
    } catch (err) {
      console.error("[microsoft] Token refresh failed:", err);
    }

    return null;
  }

  // ── Microsoft Graph API Helper ─────────────────────────────

  private async graphGet(userId: string, endpoint: string): Promise<any> {
    const accessToken: string | null = await this.getAccessToken(userId);
    if (!accessToken) throw new Error("Microsoft not connected");

    const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Microsoft Graph error: ${res.status} ${err.error?.message || res.statusText}`);
    }

    return res.json();
  }

  // ── Outlook Mail ───────────────────────────────────────────

  async outlookListMessages(userId: string = "default", filter: string = "", top: number = 10) {
    const endpoint = `/me/messages?$top=${top}&$orderby=receivedDateTime desc${filter ? `&$filter=${filter}` : ""}`;
    const data = await this.graphGet(userId, endpoint);

    return {
      messages: (data.value || []).map((m: any) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address || "",
        fromName: m.from?.emailAddress?.name || "",
        receivedAt: m.receivedDateTime,
        isRead: m.isRead,
        bodyPreview: m.bodyPreview?.substring(0, 200) || "",
      })),
      total: data.value?.length || 0,
    };
  }

  async outlookReadMessage(userId: string = "default", messageId: string) {
    const data = await this.graphGet(userId, `/me/messages/${messageId}`);

    return {
      id: data.id,
      subject: data.subject,
      from: data.from?.emailAddress?.address || "",
      fromName: data.from?.emailAddress?.name || "",
      to: data.toRecipients?.map((r: any) => r.emailAddress?.address).join(", ") || "",
      receivedAt: data.receivedDateTime,
      body: data.body?.content || "",
      isRead: data.isRead,
    };
  }

  // ── Calendar ───────────────────────────────────────────────

  async calendarListEvents(userId: string = "default", top: number = 10) {
    const data = await this.graphGet(userId, `/me/calendarView?top=${top}&orderby=start/dateTime`);

    return {
      events: (data.value || []).map((e: any) => ({
        id: e.id,
        subject: e.subject,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName || "",
        isAllDay: e.isAllDayEvent,
        organizer: e.organizer?.emailAddress?.address || "",
      })),
      total: data.value?.length || 0,
    };
  }

  // ── OneDrive ───────────────────────────────────────────────

  async onedriveListFiles(userId: string = "default", folder: string = "root", top: number = 20) {
    const data = await this.graphGet(userId, `/me/drive/root/${folder === "root" ? "" : `:${folder}:`}/children?top=${top}&orderby=lastModifiedDateTime desc`);

    return {
      files: (data.value || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.file?.mimeType || "folder",
        modifiedAt: f.lastModifiedDateTime,
        webUrl: f.webUrl,
        isFolder: !!f.folder,
      })),
      total: data.value?.length || 0,
    };
  }

  // ── Excel (via OneDrive) ───────────────────────────────────

  async excelReadSheet(userId: string = "default", fileId: string, sheetName: string = "Sheet1", range: string = "A1:Z100") {
    const data = await this.graphGet(userId, `/me/drive/items/${fileId}/workbook/worksheets/${sheetName}/range(address='${range}')`);

    return {
      values: data.values || [],
      rowCount: data.values?.length || 0,
      columnCount: data.values?.[0]?.length || 0,
    };
  }

  // ── Teams ──────────────────────────────────────────────────

  async teamsListMessages(userId: string = "default", teamId?: string, channelId?: string, top: number = 20) {
    if (teamId && channelId) {
      const data = await this.graphGet(userId, `/teams/${teamId}/channels/${channelId}/messages?top=${top}`);
      return {
        messages: (data.value || []).map((m: any) => ({
          id: m.id,
          body: m.body?.content?.substring(0, 500) || "",
          from: m.from?.user?.displayName || m.from?.application?.displayName || "",
          created_at: m.createdDateTime,
        })),
        total: data.value?.length || 0,
      };
    }

    // List teams
    const data = await this.graphGet(userId, "/me/joinedTeams");
    return {
      teams: (data.value || []).map((t: any) => ({
        id: t.id,
        name: t.displayName,
        description: t.description,
      })),
      total: data.value?.length || 0,
    };
  }
}

export const microsoftConnector = new MicrosoftConnector();
