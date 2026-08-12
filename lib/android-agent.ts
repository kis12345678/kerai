// Server side of the phone-control companion.
//
// The companion app can't be reached inbound (it's a phone on mobile data behind carrier NAT),
// so control is inverted: the phone long-polls this server for the next command, runs it via its
// Accessibility Service, and posts the result back. This module is the queue and the auth in the
// middle.
//
// Auth is a per-device bearer token. The token's hash is persisted; the plaintext is shown once
// at registration and never stored. Every poll/result call must present it — this is the boundary
// that keeps "control my phone" from meaning "control my phone, and so can anyone who finds the
// URL". Do not add an unauthenticated path here.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const STORE_REL = ".omniai/android-agent.json";

type DeviceRecord = { id: string; name: string; tokenHash: string; createdAt: number };
type Store = { devices: DeviceRecord[] };

function hashToken(token: string): string {
  // Keyed with a fixed label rather than a secret: the token itself is the high-entropy input
  // (32 random bytes), so this is a storage hash, not a password KDF.
  return createHmac("sha256", "omniai-android-agent").update(token).digest("base64url");
}

async function loadStore(root: string): Promise<Store> {
  try {
    const raw = await readFile(path.join(root, STORE_REL), "utf8");
    const parsed = JSON.parse(raw) as Store;
    return { devices: Array.isArray(parsed.devices) ? parsed.devices : [] };
  } catch {
    return { devices: [] };
  }
}

async function saveStore(root: string, store: Store): Promise<void> {
  const file = path.join(root, STORE_REL);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

export async function registerDevice(root: string, name: string): Promise<{ id: string; token: string }> {
  const store = await loadStore(root);
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  store.devices.push({ id, name: name.trim() || "Android device", tokenHash: hashToken(token), createdAt: Date.now() });
  await saveStore(root, store);
  return { id, token };
}

export async function listDevices(root: string): Promise<{ id: string; name: string; createdAt: number }[]> {
  const store = await loadStore(root);
  return store.devices.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

export async function revokeDevice(root: string, id: string): Promise<boolean> {
  const store = await loadStore(root);
  const before = store.devices.length;
  store.devices = store.devices.filter((d) => d.id !== id);
  if (store.devices.length === before) return false;
  await saveStore(root, store);
  return true;
}

/** Resolves a bearer token to a device, in constant time, or null if it matches none. */
export async function authenticateDevice(root: string, token: string | undefined): Promise<DeviceRecord | null> {
  if (!token) return null;
  const candidate = Buffer.from(hashToken(token));
  const store = await loadStore(root);
  let matched: DeviceRecord | null = null;
  // Compare against every device (not short-circuiting) so timing doesn't reveal how many
  // devices are registered or which slot matched.
  for (const device of store.devices) {
    const stored = Buffer.from(device.tokenHash);
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) matched = device;
  }
  return matched;
}

// --- Command queue (in-memory; a phone reconnecting simply re-polls) ------------------------

export type AndroidCommand = {
  id: string;
  action: string;
  params: Record<string, unknown>;
  createdAt: number;
};

type Pending = {
  command: AndroidCommand;
  resolve: (result: CommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type CommandResult = { ok: true; data: unknown } | { ok: false; error: string };

type DeviceChannel = {
  queue: AndroidCommand[];
  waiting: ((command: AndroidCommand | null) => void)[]; // long-poll resolvers
  inflight: Map<string, Pending>;
};

declare global {
  var __omniaiAndroidChannels: Map<string, DeviceChannel> | undefined;
}

const channels = (globalThis.__omniaiAndroidChannels ??= new Map<string, DeviceChannel>());

function channelFor(deviceId: string): DeviceChannel {
  let channel = channels.get(deviceId);
  if (!channel) {
    channel = { queue: [], waiting: [], inflight: new Map() };
    channels.set(deviceId, channel);
  }
  return channel;
}

const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Enqueues a command for a device and resolves when the phone reports the result — or rejects
 * with a timeout if the phone never answers (asleep, app killed, out of coverage). Callers get a
 * clean error instead of hanging the agent turn forever.
 */
export function dispatchCommand(
  deviceId: string,
  action: string,
  params: Record<string, unknown>
): Promise<CommandResult> {
  const channel = channelFor(deviceId);
  const command: AndroidCommand = { id: randomUUID(), action, params, createdAt: Date.now() };

  return new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      channel.inflight.delete(command.id);
      channel.queue = channel.queue.filter((c) => c.id !== command.id);
      resolve({ ok: false, error: "Phone did not respond within 30s — is the app open and connected?" });
    }, COMMAND_TIMEOUT_MS);

    channel.inflight.set(command.id, { command, resolve, timer });

    // Hand straight to a waiting long-poll if one is parked, else queue it.
    const waiter = channel.waiting.shift();
    if (waiter) waiter(command);
    else channel.queue.push(command);
  });
}

/** Long-poll: returns the next command for the device, or null after `waitMs` with none. */
export function nextCommand(deviceId: string, waitMs = 25_000): Promise<AndroidCommand | null> {
  const channel = channelFor(deviceId);
  const queued = channel.queue.shift();
  if (queued) return Promise.resolve(queued);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      channel.waiting = channel.waiting.filter((w) => w !== onCommand);
      resolve(null);
    }, waitMs);
    const onCommand = (command: AndroidCommand | null) => {
      clearTimeout(timer);
      resolve(command);
    };
    channel.waiting.push(onCommand);
  });
}

/** The phone reports a command's outcome. Returns false if the command was unknown/expired. */
export function submitResult(deviceId: string, commandId: string, result: CommandResult): boolean {
  const channel = channelFor(deviceId);
  const pending = channel.inflight.get(commandId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  channel.inflight.delete(commandId);
  pending.resolve(result);
  return true;
}

/** Whether a device currently has a live long-poll parked — i.e. the app is connected. */
export function isDeviceConnected(deviceId: string): boolean {
  const channel = channels.get(deviceId);
  return Boolean(channel && channel.waiting.length > 0);
}
