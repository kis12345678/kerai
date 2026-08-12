// One source of truth for "what is the state of this machine right now".
//
// Used by the dashboard API route (app/api/system-status) and the agent's getSystemStatus tool
// so the two can never drift apart. Every probe runs under its own timeout and failures are
// reported per-metric rather than killing the whole snapshot: a hanging driver or a stopped
// Ollama must degrade a single card, not blank the entire dashboard.

import si from "systeminformation";
import { getGpuStatus } from "./gpu-status";

/** How long any single OS probe may take before it's reported unavailable. */
const PROBE_TIMEOUT_MS = 3_000;
/** nvidia-smi can be slow on a busy driver; give it a bit more room. */
const GPU_TIMEOUT_MS = 4_000;
/** Ollama lives on the same machine — it should answer in milliseconds. */
const OLLAMA_TIMEOUT_MS = 3_000;

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";

type ProbeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Runs a probe with a hard deadline; never rejects. */
function withTimeout<T>(run: () => Promise<T>, ms: number, label: string): Promise<ProbeResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: `${label} timed out after ${ms}ms` }), ms);
    run()
      .then((value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: (err as Error)?.message ?? String(err) });
      });
  });
}

function gb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

async function readStorage(): Promise<{
  mount: string;
  totalGb: number;
  usedGb: number;
  usedPercent: number;
} | null> {
  const sizes = await si.fsSize();
  const cwd = process.cwd();
  // Prefer the mount the app's workspace actually lives on — that's the disk that matters.
  const mount = sizes.find((s) => s.mount && cwd.startsWith(s.mount)) ?? sizes[0];
  if (!mount) return null;
  return {
    mount: mount.mount,
    totalGb: gb(mount.size),
    usedGb: gb(mount.used),
    usedPercent: Math.round(mount.use ?? 0),
  };
}

async function readOllama(): Promise<{ connected: boolean; modelCount: number; models: string[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Ollama responded HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name?: string }[] };
    const models = (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
    return { connected: true, modelCount: models.length, models };
  } catch (err) {
    // The inner AbortSignal fires before the withTimeout wrapper does — surface a friendly
    // message rather than the raw DOMException.
    if ((err as Error).name === "AbortError") throw new Error("timed out");
    throw err;
  }
}

/**
 * Builds the full snapshot. Each field is present in the response even when unavailable —
 * `null` value plus a reason in `errors` — so a client can always render something.
 */
export async function getSystemSnapshot() {
  const [battery, cpu, mem, currentLoad, osInfo, time, gpu, storage, ollama] = await Promise.all([
    withTimeout(() => si.battery(), PROBE_TIMEOUT_MS, "battery"),
    withTimeout(() => si.cpu(), PROBE_TIMEOUT_MS, "cpu"),
    withTimeout(() => si.mem(), PROBE_TIMEOUT_MS, "memory"),
    withTimeout(() => si.currentLoad(), PROBE_TIMEOUT_MS, "cpu load"),
    withTimeout(() => si.osInfo(), PROBE_TIMEOUT_MS, "os"),
    // si.time() resolves synchronously-backed data and is effectively free; it can't fail.
    si.time(),
    withTimeout(() => getGpuStatus(), GPU_TIMEOUT_MS, "gpu"),
    withTimeout(readStorage, PROBE_TIMEOUT_MS, "storage"),
    withTimeout(readOllama, OLLAMA_TIMEOUT_MS, "ollama"),
  ]);

  const errors: Record<string, string> = {};
  // Extracts a probe result, recording its failure reason in `errors` — every metric goes
  // through this so the dashboard can always show "⚠ unavailable + <reason>" rather than a
  // silent blank.
  const probe = <T,>(result: ProbeResult<T>, key: string): T | null => {
    if (result.ok) return result.value;
    errors[key] = result.error;
    return null;
  };

  const batteryValue = probe(battery, "battery");
  const cpuValue = probe(cpu, "cpu");
  // cpu and its load are read separately; a failure of either is a CPU failure.
  const loadValue = probe(currentLoad, "cpu");
  const memValue = probe(mem, "memory");
  const osValue = probe(osInfo, "os");

  return {
    battery: batteryValue
      ? {
          hasBattery: batteryValue.hasBattery,
          percent: batteryValue.percent,
          isCharging: batteryValue.isCharging,
          timeRemainingMin: batteryValue.timeRemaining,
        }
      : null,
    cpu:
      cpuValue && loadValue
        ? {
            manufacturer: cpuValue.manufacturer,
            brand: cpuValue.brand,
            cores: cpuValue.cores,
            loadPercent: Math.round(loadValue.currentLoad),
          }
        : null,
    memory: memValue
      ? {
          totalGb: gb(memValue.total),
          usedGb: gb(memValue.total - memValue.available),
          usedPercent: Math.round(((memValue.total - memValue.available) / memValue.total) * 100),
        }
      : null,
    os: osValue
      ? { platform: osValue.platform, distro: osValue.distro, hostname: osValue.hostname }
      : null,
    gpu: probe(gpu, "gpu"),
    storage: probe(storage, "storage"),
    ollama: probe(ollama, "ollama"),
    uptimeSec: time.uptime,
    // Present only for metrics that failed; the client shows "⚠ unavailable + reason".
    errors,
  };
}

export type SystemSnapshot = Awaited<ReturnType<typeof getSystemSnapshot>>;
