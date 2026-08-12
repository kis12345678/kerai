import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Full desktop control — the "just do it" layer, so the assistant OPENS Chrome and plays the song
// instead of printing a command to copy. Everything runs on this PC (where the server lives), so
// GUI apps appear on the user's screen. This is the desktop counterpart to the phone action tools,
// and the equivalent of IRIS's device control.
//
// These are executed on Windows via PowerShell/Start-Process. Pressing media/volume keys and
// opening a Settings panel are low-risk and stay ungated — the whole point is that a spoken
// command happens immediately. The rest are not as harmless as that framing once suggested, and
// lib/tool-risk.ts is where each one's gate is decided:
//
//   - openApp resolves anything on PATH via Start-Process, so unrestricted it is a second,
//     ungated runCommand. Only known GUI apps run unprompted; anything else asks.
//   - openUrl opens the user's real, logged-in browser, exactly like the long-gated
//     openInBrowser in local-tools.ts. It now asks too.
//   - systemControl's "lock" interrupts the user and costs a password to undo; volume/mute don't.

async function ps(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 20_000, windowsHide: true }
  );
  return stdout.trim();
}

function findChrome(): string {
  return (
    "@(\"$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe\"," +
    "\"${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe\"," +
    "\"$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe\")" +
    " | Where-Object { Test-Path $_ } | Select-Object -First 1"
  );
}

// Virtual-key codes for the media/volume keys we press via keybd_event.
const VK: Record<string, number> = {
  playpause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2,
  volup: 0xaf, voldown: 0xae, mute: 0xad,
};

async function pressKey(vk: number): Promise<void> {
  await ps(
    "Add-Type -Name K -Namespace N -MemberDefinition " +
    "'[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, int e);'; " +
    `[N.K]::keybd_event(${vk},0,0,0); [N.K]::keybd_event(${vk},0,2,0)`
  );
}

// Deep links for apps that take a query; otherwise we just launch by name.
const DEEP_LINKS: Record<string, (q: string) => string> = {
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  maps: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
};

const SETTINGS_URIS: Record<string, string> = {
  wifi: "ms-settings:network-wifi",
  bluetooth: "ms-settings:bluetooth",
  display: "ms-settings:display",
  sound: "ms-settings:sound",
  battery: "ms-settings:batterysaver",
  notifications: "ms-settings:notifications",
  updates: "ms-settings:windowsupdate",
  apps: "ms-settings:appsfeatures",
  home: "ms-settings:",
};

function fail(err: unknown) {
  return { error: (err as Error).message?.trim().slice(0, 400) ?? String(err) };
}

export function createDesktopControlTools() {
  const openUrl = tool({
    description: "Open a URL in Chrome (or the default browser) on the PC. Use for playing a specific YouTube video, opening a site, etc.",
    inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }) => {
      const safe = url.trim();
      if (!/^https?:\/\//i.test(safe)) return { error: "Only http(s) URLs" };
      try {
        await ps(`$c=${findChrome()}; if ($c) { Start-Process $c -ArgumentList '${safe.replace(/'/g, "''")}' } else { Start-Process '${safe.replace(/'/g, "''")}' }`);
        return { success: true, opened: safe };
      } catch (err) { return fail(err); }
    },
  });

  const openApp = tool({
    description:
      "Open an application on the PC by name (chrome, spotify, notepad, calculator, explorer, settings, etc.), " +
      "optionally deep-linking to a search/content query for youtube, maps, or google.",
    inputSchema: z.object({
      app: z.string().describe("App name, e.g. chrome, spotify, youtube, notepad"),
      query: z.string().optional().describe("Optional search/content to open within the app"),
    }),
    execute: async ({ app, query }) => {
      const key = app.trim().toLowerCase();
      try {
        if (query && DEEP_LINKS[key]) {
          const url = DEEP_LINKS[key](query);
          await ps(`$c=${findChrome()}; if ($c) { Start-Process $c -ArgumentList '${url}' } else { Start-Process '${url}' }`);
          return { success: true, opened: `${key}: ${query}` };
        }
        // Launch by name — Start-Process resolves registered apps and PATH executables.
        const target = key === "settings" ? "ms-settings:" : key;
        await ps(`Start-Process '${target.replace(/'/g, "''")}'`);
        return { success: true, launched: key };
      } catch {
        return { error: `Couldn't open ${app}. It may not be installed.` };
      }
    },
  });

  const playOnYouTube = tool({
    description: "Play something on YouTube in Chrome — opens the search for the given song/video.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      try {
        const url = DEEP_LINKS.youtube(query);
        await ps(`$c=${findChrome()}; if ($c) { Start-Process $c -ArgumentList '${url}' } else { Start-Process '${url}' }`);
        return { success: true, playing: query };
      } catch (err) { return fail(err); }
    },
  });

  const mediaControl = tool({
    description: "Control whatever is playing media on the PC (Spotify, YouTube, etc.) via the media keys.",
    inputSchema: z.object({ action: z.enum(["playpause", "next", "previous", "stop"]) }),
    execute: async ({ action }) => {
      try { await pressKey(VK[action]!); return { success: true, action }; }
      catch (err) { return fail(err); }
    },
  });

  const systemControl = tool({
    description: "Control system audio and power: volume up/down, mute, lock the screen.",
    inputSchema: z.object({ action: z.enum(["volume_up", "volume_down", "mute", "lock"]) }),
    execute: async ({ action }) => {
      try {
        if (action === "lock") { await ps("rundll32.exe user32.dll,LockWorkStation"); return { success: true, action }; }
        const vk = action === "volume_up" ? VK.volup : action === "volume_down" ? VK.voldown : VK.mute;
        // A few presses per step so the change is actually audible.
        for (let i = 0; i < (action === "mute" ? 1 : 4); i++) await pressKey(vk!);
        return { success: true, action };
      } catch (err) { return fail(err); }
    },
  });

  const openSetting = tool({
    description: "Open a Windows Settings page: wifi, bluetooth, display, sound, battery, notifications, updates, apps.",
    inputSchema: z.object({ panel: z.enum(Object.keys(SETTINGS_URIS) as [string, ...string[]]) }),
    execute: async ({ panel }) => {
      try { await ps(`Start-Process '${SETTINGS_URIS[panel]}'`); return { success: true, opened: panel }; }
      catch (err) { return fail(err); }
    },
  });

  return { openUrl, openApp, playOnYouTube, mediaControl, systemControl, openSetting };
}
