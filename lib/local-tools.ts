import { tool } from "ai";
import { z } from "zod";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// `execFile` has no stdin option, so for commands that consume input on stdin (clip, pbcopy,
// wl-copy/xclip) we spawn and pipe. Arbitrary text can contain quotes/newlines, so never build
// a shell string for it.
function pipeText(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} timed out`));
    }, 10_000);
    child.once("error", () => {
      settle();
      reject(new Error(`failed to start ${command}`));
    });
    child.once("close", (code) => {
      settle();
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    // The target may exit before consuming all input (EPIPE) — swallow it; the close
    // handler decides the outcome. An unhandled 'error' here would crash the server.
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(text);
    } catch {
      // stdin already closed — the close handler reports the real result
    }
    child.stdin.end();
  });
}

// Local-machine tools: they touch the user's actual desktop (clipboard, default browser),
// so they run with platform-native commands and no third-party dependencies.

function platform(): "win32" | "darwin" | "linux" {
  if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux") {
    return process.platform;
  }
  return "linux";
}

async function readClipboardText(): Promise<string> {
  const p = platform();
  if (p === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout;
  }
  if (p === "darwin") {
    const { stdout } = await execFileAsync("pbpaste", [], { timeout: 10_000 });
    return stdout;
  }
  // Linux: prefer wl-paste (Wayland), fall back to xclip (X11).
  try {
    const { stdout } = await execFileAsync("wl-paste", ["--no-newline"], { timeout: 10_000 });
    return stdout;
  } catch {
    const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-o"], { timeout: 10_000 });
    return stdout;
  }
}

async function writeClipboardText(text: string): Promise<void> {
  const p = platform();
  if (p === "win32") {
    // `clip` reads its input from stdin.
    await pipeText("clip", [], text);
    return;
  }
  if (p === "darwin") {
    await pipeText("pbcopy", [], text);
    return;
  }
  try {
    await pipeText("wl-copy", [], text);
  } catch {
    await pipeText("xclip", ["-selection", "clipboard"], text);
  }
}

async function openInDefaultBrowser(url: string): Promise<void> {
  const p = platform();
  if (p === "win32") {
    // cmd /c start "" "url" — the empty "" is the window-title slot.
    await execFileAsync("cmd", ["/c", "start", "", `"${url}"`], { timeout: 10_000, windowsHide: true });
    return;
  }
  if (p === "darwin") {
    await execFileAsync("open", [url], { timeout: 10_000 });
    return;
  }
  await execFileAsync("xdg-open", [url], { timeout: 10_000 });
}

export function createLocalTools() {
  const getLocalTime = tool({
    description:
      "Get the current date, local time, timezone, and UTC offset on the user's machine. Use this " +
      "when the question involves 'now', today's date, deadlines, or converting between timezones — " +
      "the model's training data can't know what time it is.",
    inputSchema: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        date: now.toDateString(),
        time: now.toTimeString().slice(0, 8),
        iso: now.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        utcOffsetMinutes: -now.getTimezoneOffset(),
        unixSeconds: Math.floor(now.getTime() / 1000),
      };
    },
  });

  const readClipboard = tool({
    description:
      "Read the current text contents of the user's clipboard — useful for 'take what I copied and …' " +
      "workflows. Runs locally; the content never leaves the machine.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const text = await readClipboardText();
        return { text, empty: text.trim().length === 0 };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const writeClipboard = tool({
    description:
      "Copy text to the user's clipboard so they can paste it anywhere. Requires user approval.",
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => {
      try {
        await writeClipboardText(text);
        return { success: true, chars: text.length };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const openInBrowser = tool({
    description:
      "Open a URL in the user's default web browser (a real, visible browser window on their desktop — " +
      "not the headless one). Requires user approval. Only http:// and https:// URLs are allowed.",
    inputSchema: z.object({ url: z.string().describe("http(s) URL to open") }),
    execute: async ({ url }) => {
      const safe = url.trim();
      if (!/^https?:\/\//i.test(safe)) {
        return { error: "Only http:// and https:// URLs can be opened" };
      }
      // On Windows the URL is passed to `cmd /c start` — characters that could break out of
      // its quoting would allow shell injection, so reject them outright.
      if (/["`\\;|$<>\s\u0000-\u001f]/.test(safe)) {
        return { error: "URL contains characters that can't be opened safely" };
      }
      try {
        await openInDefaultBrowser(safe);
        return { success: true, url: safe };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { getLocalTime, readClipboard, writeClipboard, openInBrowser };
}
