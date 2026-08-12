import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

// Android control over ADB. Chosen over Termux/Tasker/an installed companion app because it
// needs nothing on the phone beyond Developer Options, works identically over USB and Wi-Fi,
// and is the same interface Android's own tooling uses.
//
// Every call goes through execFile with an argv array — never a shell string — so device text
// and URLs can't inject into the host shell. Arguments that the *device's* shell re-parses
// (input text, am start) are quoted separately in shellQuote().

const ADB_CANDIDATES = [
  "adb",
  "C:\\Program Files\\platform-tools\\adb.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe"),
  path.join(process.env.HOME ?? "", "Android", "Sdk", "platform-tools", "adb"),
];

let cachedAdb: string | null = null;

function adbPath(): string {
  if (cachedAdb) return cachedAdb;
  for (const candidate of ADB_CANDIDATES) {
    if (candidate === "adb" || (candidate && existsSync(candidate))) {
      cachedAdb = candidate;
      return candidate;
    }
  }
  cachedAdb = "adb";
  return cachedAdb;
}

/** Quotes a string for the *device's* shell, which re-parses what adb forwards. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type AdbResult = { stdout: string; stderr: string };

async function adb(args: string[], timeoutMs = 20_000): Promise<AdbResult> {
  const { stdout, stderr } = await execFileAsync(adbPath(), args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** Binary-safe variant, for screencap. */
async function adbBinary(args: string[], timeoutMs = 30_000): Promise<Buffer> {
  const { stdout } = await execFileAsync(adbPath(), args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  return stdout as unknown as Buffer;
}

export type AndroidDevice = { serial: string; state: string; model?: string };

async function listDevices(): Promise<AndroidDevice[]> {
  const { stdout } = await adb(["devices", "-l"]);
  return stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*"))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const model = rest.find((r) => r.startsWith("model:"))?.slice(6);
      return { serial: serial!, state: state ?? "unknown", model };
    });
}

const NO_DEVICE_HELP =
  "No Android device is connected. To connect: (1) on the phone enable Developer Options " +
  "(tap Build number 7 times) then USB debugging; (2) plug in over USB and accept the " +
  "'Allow USB debugging' prompt; or for Wi-Fi, enable Wireless debugging and use " +
  "androidConnect with the host:port it shows.";

/** Resolves which device to target, erroring clearly rather than letting adb pick silently. */
async function resolveTarget(serial?: string): Promise<{ args: string[] } | { error: string }> {
  const devices = await listDevices();
  const usable = devices.filter((d) => d.state === "device");

  if (serial) {
    const match = usable.find((d) => d.serial === serial);
    if (!match) return { error: `Device "${serial}" is not connected/authorised.` };
    return { args: ["-s", serial] };
  }
  if (usable.length === 0) {
    const unauthorised = devices.find((d) => d.state === "unauthorized");
    if (unauthorised) {
      return {
        error:
          `Device ${unauthorised.serial} is connected but UNAUTHORISED — unlock the phone and ` +
          `accept the "Allow USB debugging" prompt, then retry.`,
      };
    }
    return { error: NO_DEVICE_HELP };
  }
  if (usable.length > 1) {
    return {
      error: `Multiple devices connected (${usable.map((d) => d.serial).join(", ")}). Pass "serial" to choose one.`,
    };
  }
  return { args: ["-s", usable[0]!.serial] };
}

export type UiNode = {
  text?: string;
  id?: string;
  desc?: string;
  className?: string;
  clickable: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  center: { x: number; y: number };
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Parses uiautomator's XML dump into a flat list of on-screen elements.
 *
 * Regex rather than an XML parser: the dump is machine-generated with a fixed attribute
 * shape, it can be several hundred KB, and adding an XML dependency for one shallow read
 * isn't worth it. Nodes without parseable bounds are skipped rather than guessed at.
 */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const nodeRe = /<node\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = nodeRe.exec(xml)) !== null) {
    const attrs = match[1]!;
    const attr = (name: string) => {
      const found = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
      return found ? decodeXmlEntities(found[1]!) : undefined;
    };
    const bounds = attr("bounds")?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!bounds) continue;
    const [x1, y1, x2, y2] = [+bounds[1]!, +bounds[2]!, +bounds[3]!, +bounds[4]!];
    // Zero-area nodes are layout scaffolding, not things a user can touch.
    if (x2 <= x1 || y2 <= y1) continue;

    nodes.push({
      text: attr("text") || undefined,
      id: attr("resource-id") || undefined,
      desc: attr("content-desc") || undefined,
      className: attr("class")?.split(".").pop() || undefined,
      clickable: attr("clickable") === "true",
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return nodes;
}

/** Ranks candidates so an exact label beats a substring, and a tappable node beats a label. */
export function findUiNode(nodes: UiNode[], query: string): UiNode | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const scored = nodes
    .map((n) => {
      const fields = [n.text, n.desc, n.id].filter(Boolean).map((f) => f!.toLowerCase());
      if (!fields.length) return null;
      let score = 0;
      if (fields.some((f) => f === needle)) score = 100;
      else if (fields.some((f) => f.split("/").pop() === needle)) score = 90; // resource-id tail
      else if (fields.some((f) => f.includes(needle))) score = 50;
      else return null;
      if (n.clickable) score += 25;
      return { node: n, score };
    })
    .filter((s): s is { node: UiNode; score: number } => s !== null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.node ?? null;
}

function fail(err: unknown): { error: string } {
  const message = (err as Error).message ?? String(err);
  if (/ENOENT/.test(message)) {
    return { error: "adb not found. Install Android platform-tools and ensure adb is on PATH." };
  }
  return { error: message.trim().slice(0, 600) };
}

export function createAndroidTools(root: string) {
  /** Runs an adb subcommand against the resolved device. */
  async function onDevice(serial: string | undefined, args: string[], timeoutMs?: number) {
    const target = await resolveTarget(serial);
    if ("error" in target) return target;
    return adb([...target.args, ...args], timeoutMs);
  }

  const androidDevices = tool({
    description:
      "List Android devices currently reachable over ADB (USB or Wi-Fi), with their serial, " +
      "connection state, and model. Use this first when the user asks about their phone, to " +
      "confirm something is actually connected before trying to control it.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const devices = await listDevices();
        return devices.length
          ? { devices, count: devices.length }
          : { devices: [], count: 0, hint: NO_DEVICE_HELP };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidConnect = tool({
    description:
      "Connect to an Android device over Wi-Fi via ADB, e.g. '192.168.1.42:5555'. The phone must " +
      "have Wireless debugging enabled (Android 11+) or have had 'adb tcpip 5555' run over USB first. " +
      "Requires user approval.",
    inputSchema: z.object({
      hostPort: z.string().describe("Device address as host:port, e.g. 192.168.1.42:5555"),
    }),
    execute: async ({ hostPort }) => {
      if (!/^[\w.-]+:\d{1,5}$/.test(hostPort.trim())) {
        return { error: "Expected host:port, e.g. 192.168.1.42:5555" };
      }
      try {
        const { stdout } = await adb(["connect", hostPort.trim()], 15_000);
        const text = stdout.trim();
        return { success: /connected/i.test(text) && !/failed|cannot/i.test(text), message: text };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidInfo = tool({
    description:
      "Get the connected Android phone's model, Android version, battery level and charging state, " +
      "screen resolution, and whether the screen is currently on. Read-only.",
    inputSchema: z.object({ serial: z.string().optional() }),
    execute: async ({ serial }) => {
      try {
        const target = await resolveTarget(serial);
        if ("error" in target) return target;
        const run = async (cmd: string[]) => (await adb([...target.args, "shell", ...cmd])).stdout.trim();

        const [model, brand, release, sdk, sizeRaw, batteryRaw] = await Promise.all([
          run(["getprop", "ro.product.model"]),
          run(["getprop", "ro.product.brand"]),
          run(["getprop", "ro.build.version.release"]),
          run(["getprop", "ro.build.version.sdk"]),
          run(["wm", "size"]),
          run(["dumpsys", "battery"]),
        ]);

        const size = sizeRaw.match(/Physical size:\s*(\d+)x(\d+)/);
        const level = batteryRaw.match(/level:\s*(\d+)/)?.[1];
        const plugged = batteryRaw.match(/powered:\s*(true|false)/)?.[1];
        const acPowered = /AC powered:\s*true/.test(batteryRaw);
        const usbPowered = /USB powered:\s*true/.test(batteryRaw);

        return {
          model: `${brand} ${model}`.trim(),
          androidVersion: release,
          sdkLevel: Number(sdk) || sdk,
          screen: size ? { width: Number(size[1]), height: Number(size[2]) } : undefined,
          batteryPercent: level ? Number(level) : undefined,
          charging: plugged === "true" || acPowered || usbPowered,
        };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidScreenshot = tool({
    description:
      "Capture the Android phone's current screen and save it as a PNG in the workspace. Returns the " +
      "file path and image dimensions. Use this to SEE the phone before tapping — coordinates for " +
      "androidTap must come from looking at a real screenshot, never guessed.",
    inputSchema: z.object({ serial: z.string().optional() }),
    execute: async ({ serial }) => {
      try {
        const target = await resolveTarget(serial);
        if ("error" in target) return target;
        const png = await adbBinary([...target.args, "exec-out", "screencap", "-p"]);
        if (!png?.length) return { error: "screencap returned no data" };

        const dir = path.join(root, ".omniai", "android");
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `screen-${Date.now()}.png`);
        await writeFile(file, png);

        // PNG IHDR: width/height are big-endian uint32 at byte offsets 16 and 20.
        const width = png.length > 24 ? png.readUInt32BE(16) : undefined;
        const height = png.length > 24 ? png.readUInt32BE(20) : undefined;
        return { path: file, bytes: png.length, width, height };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidTap = tool({
    description:
      "Tap the Android screen at pixel coordinates. Take a screenshot first and read the real " +
      "coordinates from it. Requires user approval.",
    inputSchema: z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      serial: z.string().optional(),
    }),
    execute: async ({ x, y, serial }) => {
      try {
        const res = await onDevice(serial, ["shell", "input", "tap", String(x), String(y)]);
        if ("error" in res) return res;
        return { success: true, tapped: { x, y } };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidSwipe = tool({
    description:
      "Swipe on the Android screen from one point to another over a duration in milliseconds. Use for " +
      "scrolling (swipe up/down), unlocking, and page changes. Requires user approval.",
    inputSchema: z.object({
      x1: z.number().int().nonnegative(),
      y1: z.number().int().nonnegative(),
      x2: z.number().int().nonnegative(),
      y2: z.number().int().nonnegative(),
      durationMs: z.number().int().positive().max(10_000).default(300),
      serial: z.string().optional(),
    }),
    execute: async ({ x1, y1, x2, y2, durationMs, serial }) => {
      try {
        const res = await onDevice(serial, [
          "shell", "input", "swipe",
          String(x1), String(y1), String(x2), String(y2), String(durationMs),
        ]);
        if ("error" in res) return res;
        return { success: true, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, durationMs };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidTypeText = tool({
    description:
      "Type text into whatever field currently has focus on the Android phone. ASCII only — " +
      "Android's `input text` cannot enter emoji or most non-Latin characters. Requires user approval.",
    inputSchema: z.object({
      text: z.string().max(2000),
      serial: z.string().optional(),
    }),
    execute: async ({ text, serial }) => {
      if (!/^[\x20-\x7E]*$/.test(text)) {
        return { error: "Only printable ASCII can be typed via adb input text." };
      }
      try {
        const res = await onDevice(serial, ["shell", `input text ${shellQuote(text)}`]);
        if ("error" in res) return res;
        return { success: true, chars: text.length };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidKey = tool({
    description:
      "Press a hardware/system key on the Android phone. Common keys: HOME, BACK, ENTER, POWER, " +
      "VOLUME_UP, VOLUME_DOWN, APP_SWITCH (recents), CAMERA, MENU, DEL, TAB, SEARCH. " +
      "Requires user approval.",
    inputSchema: z.object({
      key: z.string().describe("Keycode name without the KEYCODE_ prefix, e.g. HOME"),
      serial: z.string().optional(),
    }),
    execute: async ({ key, serial }) => {
      const normalised = key.trim().toUpperCase().replace(/^KEYCODE_/, "");
      // Keycodes are a fixed vocabulary; anything else would be forwarded to the device shell.
      if (!/^[A-Z0-9_]{1,32}$/.test(normalised)) return { error: `Invalid keycode: ${key}` };
      try {
        const res = await onDevice(serial, ["shell", "input", "keyevent", `KEYCODE_${normalised}`]);
        if ("error" in res) return res;
        return { success: true, key: normalised };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidOpenUrl = tool({
    description:
      "Open a URL on the Android phone in its default browser (or the app registered for that link). " +
      "Requires user approval.",
    inputSchema: z.object({
      url: z.string(),
      serial: z.string().optional(),
    }),
    execute: async ({ url, serial }) => {
      const safe = url.trim();
      if (!/^https?:\/\//i.test(safe)) return { error: "Only http:// and https:// URLs are allowed" };
      try {
        const res = await onDevice(serial, [
          "shell",
          `am start -a android.intent.action.VIEW -d ${shellQuote(safe)}`,
        ]);
        if ("error" in res) return res;
        return { success: true, url: safe };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidListApps = tool({
    description:
      "List app packages installed on the Android phone. By default only user-installed apps; set " +
      "includeSystem to include system packages. Read-only.",
    inputSchema: z.object({
      includeSystem: z.boolean().default(false),
      filter: z.string().optional().describe("Case-insensitive substring to match against package names"),
      serial: z.string().optional(),
    }),
    execute: async ({ includeSystem, filter, serial }) => {
      try {
        const res = await onDevice(serial, ["shell", "pm", "list", "packages", ...(includeSystem ? [] : ["-3"])]);
        if ("error" in res) return res;
        let packages = res.stdout
          .split("\n")
          .map((l) => l.trim().replace(/^package:/, ""))
          .filter(Boolean);
        if (filter) {
          const needle = filter.toLowerCase();
          packages = packages.filter((p) => p.toLowerCase().includes(needle));
        }
        return { packages: packages.slice(0, 300), count: packages.length };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidLaunchApp = tool({
    description:
      "Launch an app on the Android phone by its package name (find it with androidListApps). " +
      "Requires user approval.",
    inputSchema: z.object({
      packageName: z.string(),
      serial: z.string().optional(),
    }),
    execute: async ({ packageName, serial }) => {
      const pkg = packageName.trim();
      if (!/^[A-Za-z0-9_.]+$/.test(pkg)) return { error: `Invalid package name: ${packageName}` };
      try {
        const res = await onDevice(serial, [
          "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1",
        ]);
        if ("error" in res) return res;
        const failed = /No activities found|Error/i.test(res.stdout + res.stderr);
        return failed
          ? { error: `Could not launch ${pkg} — is it installed?` }
          : { success: true, launched: pkg };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidNotifications = tool({
    description:
      "Read the Android phone's current notifications (app, title, and text where available). " +
      "Useful for 'what did I miss on my phone'. Read-only.",
    inputSchema: z.object({ serial: z.string().optional() }),
    execute: async ({ serial }) => {
      try {
        const res = await onDevice(serial, ["shell", "dumpsys", "notification", "--noredact"], 30_000);
        if ("error" in res) return res;
        const notifications: { pkg: string; title?: string; text?: string }[] = [];
        // dumpsys output is one record per NotificationRecord block; pull the fields we care
        // about rather than trying to parse the whole structure.
        const blocks = res.stdout.split(/NotificationRecord\(/).slice(1);
        for (const block of blocks.slice(0, 40)) {
          const pkg = block.match(/pkg=([\w.]+)/)?.[1];
          if (!pkg) continue;
          const title = block.match(/android\.title=(?:String\s*\()?([^\n)]*)/)?.[1]?.trim();
          const text = block.match(/android\.text=(?:String\s*\()?([^\n)]*)/)?.[1]?.trim();
          notifications.push({ pkg, title: title || undefined, text: text || undefined });
        }
        return { notifications, count: notifications.length };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidShell = tool({
    description:
      "Run an arbitrary shell command on the Android phone via adb shell. This is the escape hatch " +
      "for anything the other tools don't cover. Powerful and unrestricted — requires user approval. " +
      "Prefer a specific tool when one exists.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to run on the device"),
      serial: z.string().optional(),
    }),
    execute: async ({ command, serial }) => {
      try {
        const res = await onDevice(serial, ["shell", command], 60_000);
        if ("error" in res) return res;
        return {
          stdout: res.stdout.slice(0, 20_000),
          stderr: res.stderr.slice(0, 4000),
          truncated: res.stdout.length > 20_000,
        };
      } catch (err) {
        return fail(err);
      }
    },
  });

  async function dumpUi(serial?: string): Promise<{ nodes: UiNode[] } | { error: string }> {
    const target = await resolveTarget(serial);
    if ("error" in target) return target;
    // uiautomator writes to a file; dumping straight to stdout is unreliable across versions.
    const remote = "/sdcard/window_dump.xml";
    await adb([...target.args, "shell", "uiautomator", "dump", remote], 40_000);
    const { stdout } = await adb([...target.args, "shell", "cat", remote], 40_000);
    const nodes = parseUiNodes(stdout);
    if (!nodes.length) {
      return {
        error:
          "UI dump returned no elements. The screen may be locked, showing a secure surface " +
          "(banking apps and the keyguard block dumping), or mid-animation — retry after a moment.",
      };
    }
    return { nodes };
  }

  /** Keeps the local side of push/pull inside the workspace. */
  function localInWorkspace(p: string): string | null {
    const resolved = path.resolve(root, p);
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
  }

  const androidUiDump = tool({
    description:
      "Read the Android screen's UI tree — every visible element with its text, resource id, " +
      "content description, and tap coordinates. Far more reliable than reading a screenshot: use " +
      "this to find out what is actually on screen and where, then tap by text with androidTapText. " +
      "Read-only.",
    inputSchema: z.object({
      clickableOnly: z.boolean().default(false).describe("Only return elements that can be tapped"),
      filter: z.string().optional().describe("Case-insensitive substring to match text/id/description"),
      serial: z.string().optional(),
    }),
    execute: async ({ clickableOnly, filter, serial }) => {
      try {
        const dump = await dumpUi(serial);
        if ("error" in dump) return dump;
        let nodes = dump.nodes;
        if (clickableOnly) nodes = nodes.filter((n) => n.clickable);
        if (filter) {
          const needle = filter.toLowerCase();
          nodes = nodes.filter((n) =>
            [n.text, n.desc, n.id].some((f) => f?.toLowerCase().includes(needle))
          );
        }
        // Labelless layout containers add noise without helping the model decide.
        const useful = nodes.filter((n) => n.text || n.desc || n.id || n.clickable);
        return {
          elements: useful.slice(0, 120).map((n) => ({
            text: n.text,
            id: n.id,
            desc: n.desc,
            type: n.className,
            clickable: n.clickable,
            tapAt: n.center,
          })),
          count: useful.length,
          truncated: useful.length > 120,
        };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidTapText = tool({
    description:
      "Find an on-screen element by its visible text, content description, or resource id and tap its " +
      "centre. Prefer this over androidTap — it reads the live UI tree, so it stays correct when " +
      "layouts shift, unlike hardcoded coordinates. Requires user approval.",
    inputSchema: z.object({
      query: z.string().describe("Visible label, content description, or resource id to tap"),
      serial: z.string().optional(),
    }),
    execute: async ({ query, serial }) => {
      try {
        const dump = await dumpUi(serial);
        if ("error" in dump) return dump;
        const node = findUiNode(dump.nodes, query);
        if (!node) {
          const visible = dump.nodes
            .map((n) => n.text || n.desc)
            .filter(Boolean)
            .slice(0, 25);
          return { error: `No element matching "${query}". Visible labels: ${visible.join(" | ")}` };
        }
        const res = await onDevice(serial, [
          "shell", "input", "tap", String(node.center.x), String(node.center.y),
        ]);
        if ("error" in res) return res;
        return {
          success: true,
          matched: { text: node.text, id: node.id, desc: node.desc, clickable: node.clickable },
          tappedAt: node.center,
        };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidPair = tool({
    description:
      "Pair with an Android 11+ phone for wireless debugging, using the host:port and 6-digit code " +
      "shown under Developer options → Wireless debugging → Pair device with pairing code. This is a " +
      "one-time setup per phone; afterwards use androidConnect. Requires user approval.",
    inputSchema: z.object({
      hostPort: z.string().describe("Pairing address shown on the phone, e.g. 192.168.1.42:37105"),
      code: z.string().describe("6-digit pairing code shown on the phone"),
    }),
    execute: async ({ hostPort, code }) => {
      if (!/^[\w.-]+:\d{1,5}$/.test(hostPort.trim())) {
        return { error: "Expected host:port, e.g. 192.168.1.42:37105" };
      }
      if (!/^\d{6}$/.test(code.trim())) return { error: "Pairing code must be 6 digits" };
      try {
        const { stdout, stderr } = await adb(["pair", hostPort.trim(), code.trim()], 30_000);
        const text = (stdout + stderr).trim();
        return { success: /Successfully paired/i.test(text), message: text };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidEnableWireless = tool({
    description:
      "Switch a USB-connected phone into wireless ADB mode and report the address to connect to, so " +
      "the cable can be unplugged. Requires user approval.",
    inputSchema: z.object({
      port: z.number().int().min(1024).max(65535).default(5555),
      serial: z.string().optional(),
    }),
    execute: async ({ port, serial }) => {
      try {
        const target = await resolveTarget(serial);
        if ("error" in target) return target;
        await adb([...target.args, "tcpip", String(port)], 20_000);
        const { stdout } = await adb([...target.args, "shell", "ip", "route"], 15_000);
        const ip = stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/)?.[1];
        return ip
          ? { success: true, connectTo: `${ip}:${port}`, note: "Unplug USB, then call androidConnect with this address." }
          : { success: true, note: `Wireless mode on port ${port}, but the phone's IP could not be read. Check Settings → About → Status.` };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidUnlock = tool({
    description:
      "Wake and unlock the Android phone: turns the screen on and swipes up, optionally entering a " +
      "numeric PIN. Needed before most UI automation, since the keyguard blocks both tapping and UI " +
      "dumps. Requires user approval.",
    inputSchema: z.object({
      pin: z.string().optional().describe("Numeric unlock PIN, if the phone has one"),
      serial: z.string().optional(),
    }),
    execute: async ({ pin, serial }) => {
      if (pin && !/^\d{4,16}$/.test(pin)) return { error: "PIN must be 4-16 digits" };
      try {
        const target = await resolveTarget(serial);
        if ("error" in target) return target;
        const sh = (cmd: string[]) => adb([...target.args, "shell", ...cmd], 15_000);

        await sh(["input", "keyevent", "KEYCODE_WAKEUP"]);
        const { stdout: size } = await sh(["wm", "size"]);
        const dims = size.match(/Physical size:\s*(\d+)x(\d+)/);
        const w = dims ? Number(dims[1]) : 1080;
        const h = dims ? Number(dims[2]) : 1920;
        await sh(["input", "swipe", String(Math.round(w / 2)), String(Math.round(h * 0.8)),
                  String(Math.round(w / 2)), String(Math.round(h * 0.2)), "200"]);
        if (pin) {
          await sh(["input", "text", pin]);
          await sh(["input", "keyevent", "KEYCODE_ENTER"]);
        }
        const { stdout: state } = await sh(["dumpsys", "window"]);
        const locked = /mDreamingLockscreen=true|isStatusBarKeyguard=true/.test(state);
        return { success: true, stillLocked: locked || undefined };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidPull = tool({
    description:
      "Copy a file from the Android phone to the workspace (photos, downloads, logs). The local " +
      "destination is restricted to inside the workspace directory.",
    inputSchema: z.object({
      remotePath: z.string().describe("Path on the phone, e.g. /sdcard/DCIM/Camera/IMG_0001.jpg"),
      localPath: z.string().describe("Destination relative to the workspace root"),
      serial: z.string().optional(),
    }),
    execute: async ({ remotePath, localPath, serial }) => {
      const dest = localInWorkspace(localPath);
      if (!dest) return { error: "localPath must stay inside the workspace directory" };
      try {
        await mkdir(path.dirname(dest), { recursive: true });
        const res = await onDevice(serial, ["pull", remotePath, dest], 120_000);
        if ("error" in res) return res;
        return { success: existsSync(dest), localPath: dest, output: res.stdout.trim().slice(0, 500) };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidPush = tool({
    description:
      "Copy a file from the workspace onto the Android phone. The local source is restricted to " +
      "inside the workspace directory. Requires user approval.",
    inputSchema: z.object({
      localPath: z.string().describe("Source relative to the workspace root"),
      remotePath: z.string().describe("Destination on the phone, e.g. /sdcard/Download/file.pdf"),
      serial: z.string().optional(),
    }),
    execute: async ({ localPath, remotePath, serial }) => {
      const src = localInWorkspace(localPath);
      if (!src) return { error: "localPath must stay inside the workspace directory" };
      if (!existsSync(src)) return { error: `No such file: ${src}` };
      try {
        const res = await onDevice(serial, ["push", src, remotePath], 120_000);
        if ("error" in res) return res;
        return { success: true, remotePath, output: res.stdout.trim().slice(0, 500) };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidInstall = tool({
    description:
      "Install an APK from the workspace onto the phone (reinstalls if already present, keeping data). " +
      "Requires user approval.",
    inputSchema: z.object({
      apkPath: z.string().describe("APK path relative to the workspace root"),
      serial: z.string().optional(),
    }),
    execute: async ({ apkPath, serial }) => {
      const src = localInWorkspace(apkPath);
      if (!src) return { error: "apkPath must stay inside the workspace directory" };
      if (!existsSync(src)) return { error: `No such file: ${src}` };
      try {
        const res = await onDevice(serial, ["install", "-r", src], 180_000);
        if ("error" in res) return res;
        const out = (res.stdout + res.stderr).trim();
        return /Success/i.test(out) ? { success: true, apk: src } : { error: out.slice(0, 600) };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidUninstall = tool({
    description: "Uninstall an app from the phone by package name. Requires user approval.",
    inputSchema: z.object({
      packageName: z.string(),
      serial: z.string().optional(),
    }),
    execute: async ({ packageName, serial }) => {
      const pkg = packageName.trim();
      if (!/^[A-Za-z0-9_.]+$/.test(pkg)) return { error: `Invalid package name: ${packageName}` };
      try {
        const res = await onDevice(serial, ["uninstall", pkg], 60_000);
        if ("error" in res) return res;
        const out = (res.stdout + res.stderr).trim();
        return /Success/i.test(out) ? { success: true, removed: pkg } : { error: out.slice(0, 400) };
      } catch (err) {
        return fail(err);
      }
    },
  });

  const androidScreenRecord = tool({
    description:
      "Record the phone's screen for a number of seconds and save the video into the workspace. " +
      "Blocks for the full duration. Requires user approval.",
    inputSchema: z.object({
      seconds: z.number().int().min(1).max(180).default(10),
      serial: z.string().optional(),
    }),
    execute: async ({ seconds, serial }) => {
      try {
        const target = await resolveTarget(serial);
        if ("error" in target) return target;
        const remote = `/sdcard/omniai-rec-${Date.now()}.mp4`;
        await adb(
          [...target.args, "shell", "screenrecord", "--time-limit", String(seconds), remote],
          (seconds + 30) * 1000
        );
        const dir = path.join(root, ".omniai", "android");
        await mkdir(dir, { recursive: true });
        const dest = path.join(dir, path.basename(remote));
        await adb([...target.args, "pull", remote, dest], 120_000);
        await adb([...target.args, "shell", "rm", "-f", remote], 15_000).catch(() => {});
        return existsSync(dest)
          ? { success: true, path: dest, seconds }
          : { error: "Recording finished but the file could not be pulled." };
      } catch (err) {
        return fail(err);
      }
    },
  });

  return {
    androidDevices,
    androidConnect,
    androidPair,
    androidEnableWireless,
    androidInfo,
    androidScreenshot,
    androidUiDump,
    androidTap,
    androidTapText,
    androidSwipe,
    androidTypeText,
    androidKey,
    androidUnlock,
    androidOpenUrl,
    androidListApps,
    androidLaunchApp,
    androidInstall,
    androidUninstall,
    androidPush,
    androidPull,
    androidNotifications,
    androidScreenRecord,
    androidShell,
  };
}
