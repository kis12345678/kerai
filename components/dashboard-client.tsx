"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AiOrb } from "@/components/ai-orb";
import { useActivity } from "@/components/activity-context";
import type { SystemSnapshot } from "@/lib/system-snapshot";
import type { GpuStatus } from "@/lib/gpu-status";

// The server page SSR-renders the initial snapshot so the very first HTML (and first paint)
// already carries real telemetry; this component polls to keep it fresh. initialError is set
// only when the snapshot threw at SSR time, so the offline banner is part of the HTML too — a
// non-JS reader always sees either data or an explicit "backend offline", never a loading
// placeholder.
type Props = { initial: SystemSnapshot | null; initialError?: string | null };

type SystemStatus = {
  battery: {
    hasBattery: boolean;
    percent?: number;
    isCharging?: boolean;
    timeRemainingMin?: number | null;
  } | null;
  cpu: { manufacturer: string; brand: string; cores: number; loadPercent: number } | null;
  memory: { totalGb: number; usedGb: number; usedPercent: number } | null;
  os: { platform: string; distro: string; hostname: string } | null;
  gpu: GpuStatus | null;
  storage: { mount: string; totalGb: number; usedGb: number; usedPercent: number } | null;
  ollama: { connected: boolean; modelCount: number; models: string[] } | null;
  uptimeSec: number;
  errors?: Record<string, string>;
};

type Automation = {
  id: string;
  label: string;
  prompt: string;
  workspaceRoot: string;
  model: string;
  schedule: { type: "daily"; hhmm: string } | { type: "interval"; everyMinutes: number };
  createdAt: number;
  enabled: boolean;
  lastRunAt: number | null;
  lastResult: string | null;
  lastError: string | null;
};

const POLL_MS = 5000;
const AUTOMATIONS_POLL_MS = 15_000;
// The server bounds each probe individually, but a stuck TCP connection shouldn't be able to
// leave the dashboard on "Reading system status…" forever either — abort after this.
const FETCH_TIMEOUT_MS = 6000;

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatClock(date: Date): string {
  // Fixed locale + 24h so the server and client render byte-identical strings (default locale
  // ICU differs between Node and the browser — "PM" vs "pm" — which broke hydration).
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatCard({
  label,
  value,
  sub,
  barPercent,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  barPercent?: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-accent/30">
      <div className="text-xs uppercase tracking-wide text-fog/70">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-frost">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${warn ? "text-amber-300" : "text-fog"}`}>{sub}</div>}
      {barPercent !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-edge">
          <div
            className="h-full rounded-full bg-accent shadow-accent transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function unavailableReason(status: SystemStatus | null, metric: string): string | undefined {
  return status?.errors?.[metric];
}

/** Next time an enabled automation will fire, in ms since epoch. */
function nextRunTime(a: Automation): number {
  const now = Date.now();
  if (a.schedule.type === "interval") {
    const next = (a.lastRunAt ?? 0) + a.schedule.everyMinutes * 60_000;
    // Already overdue counts as due now (the scheduler fires within a minute).
    return next > now ? next : now;
  }
  const [hh, mm] = a.schedule.hhmm.split(":").map(Number);
  const today = new Date();
  today.setHours(hh ?? 0, mm ?? 0, 0, 0);
  if (today.getTime() > now) return today.getTime();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getTime();
}

function ActivityCard() {
  const { activity } = useActivity();
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-fog/70">Live activity</div>
        <span
          className={`h-2 w-2 rounded-full ${activity.active ? "animate-pulse bg-accent" : "bg-fog/40"}`}
          title={activity.active ? "A task is running" : "Idle"}
        />
      </div>
      {activity.active ? (
        <div className="mt-2 text-sm text-frost">
          <span className={activity.agentAccent ?? "text-frost"}>
            {activity.agentEmoji ?? "🤖"} {activity.agentName ?? "Kerai AI"}
          </span>{" "}
          {activity.lastTool ? (
            <span className="text-fog">is running <span className="font-mono text-frost/75">{activity.lastTool}</span>…</span>
          ) : (
            <span className="text-fog">is thinking…</span>
          )}
        </div>
      ) : activity.agentName ? (
        <div className="mt-2 text-sm text-fog">
          Idle — last turn was{" "}
          <span className={activity.agentAccent}>{activity.agentEmoji} {activity.agentName}</span>
          {activity.lastTool && (
            <>
              {" "}(last action: <span className="font-mono text-frost/75">{activity.lastTool}</span>)
            </>
          )}
        </div>
      ) : (
        <div className="mt-2 text-sm text-fog">Idle — nothing running right now.</div>
      )}
    </div>
  );
}

function AutomationsCard() {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function poll() {
      try {
        // The store is a fast local file read, but a stuck request must not leave this card
        // on "Loading…" forever — same discipline as the system-status polling.
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch("/api/automations", { signal: controller.signal });
          if (!res.ok) throw new Error(`Status ${res.status}`);
          const data = (await res.json()) as { automations: Automation[] };
          if (!cancelled) {
            setAutomations(data.automations);
            setFailed(false);
          }
        } finally {
          clearTimeout(timer);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    poll();
    const interval = setInterval(poll, AUTOMATIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      controller.abort();
    };
  }, []);

  const active = automations?.filter((a) => a.enabled) ?? [];
  const paused = automations?.filter((a) => !a.enabled) ?? [];
  const failures = (automations ?? []).filter((a) => a.lastError);
  const next = active
    .map((a) => ({ a, at: nextRunTime(a) }))
    .sort((x, y) => x.at - y.at)[0];

  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-fog/70">Automations</div>
        <Link
          href="/automations"
          className="rounded-md border border-edge bg-surface px-2 py-0.5 text-xs text-fog hover:bg-edge hover:text-frost"
        >
          Manage →
        </Link>
      </div>

      {failed ? (
        <div className="mt-2 text-sm text-amber-300">⚠ Couldn&apos;t load automations.</div>
      ) : automations === null ? (
        <div className="mt-2 text-sm text-fog">Loading…</div>
      ) : automations.length === 0 ? (
        <div className="mt-2 text-sm text-fog">
          No automations yet — <Link href="/automations" className="text-accent hover:underline">create one</Link>.
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-frost">
              <span className="font-semibold text-accent">{active.length}</span>{" "}
              <span className="text-fog">active</span>
            </span>
            <span className="text-frost">
              <span className="font-semibold">{paused.length}</span>{" "}
              <span className="text-fog">paused</span>
            </span>
            {failures.length > 0 && (
              <span className="text-red-300">
                ⚠ {failures.length} last run failed
              </span>
            )}
          </div>
          {next ? (
            <div className="mt-1.5 truncate text-xs text-fog">
              Next: <span className="text-frost/75">{next.a.label}</span> at{" "}
              {new Date(next.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-fog">Nothing scheduled — all paused.</div>
          )}
          {failures[0] && (
            <div className="mt-1.5 truncate text-xs text-red-300/90" title={failures[0].lastError ?? ""}>
              Latest failure: {failures[0].label}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function DashboardClient({ initial, initialError }: Props) {
  const [status, setStatus] = useState<SystemStatus | null>(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);
  // The clock is client-only by construction: it starts null on BOTH server and client (a
  // Date.now() initializer would differ between the SSR and hydration renders and break
  // hydration), and it's further gated on `mounted` so it can never exist during hydration
  // no matter what. The SSR snapshot still seeds the metrics; the clock appears after the
  // first successful poll.
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    let cancelled = false;
    // One controller per effect instance: the timeout aborts a stuck request, and cleanup
    // aborts whatever is still in flight so a retry/unmount never leaves a connection hanging.
    const controller = new AbortController();

    async function poll() {
      if (inFlight.current) return; // a slow request must not stack more on top of itself
      inFlight.current = true;
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch("/api/system-status", { signal: controller.signal });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as SystemStatus;
        if (!cancelled) {
          setStatus(data);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (err) {
        if (!cancelled) {
          // Cleanup aborts are silent (it sets cancelled first); an abort with cancelled still
          // false is the fetch timeout, which the user should hear about. Either way the last
          // good snapshot stays on screen — a failed refresh never blanks the page.
          setError(
            (err as Error).name === "AbortError"
              ? "Status request timed out — showing the last snapshot."
              : `Couldn't refresh: ${(err as Error).message}`
          );
        }
      } finally {
        inFlight.current = false;
        clearTimeout(timer);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      controller.abort();
    };
  }, [retryKey]);

  const orbState =
    status && ((status.cpu?.loadPercent ?? 0) > 60 || (status.gpu?.utilizationPercent ?? 0) > 60)
      ? "thinking"
      : "idle";

  const gpuUnavailable = unavailableReason(status, "gpu");
  const batteryUnavailable = unavailableReason(status, "battery");
  const storageUnavailable = unavailableReason(status, "storage");
  const ollamaUnavailable = unavailableReason(status, "ollama");

  return (
    <>
      <header className="flex items-center gap-2 border-b border-edge px-4 py-3 sm:px-6">
        <h1 className="text-sm font-medium text-frost/75">Dashboard</h1>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-fog">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Live · refreshes every {POLL_MS / 1000}s
          {mounted && lastUpdated && <span className="text-fog/70">· updated {formatClock(lastUpdated)}</span>}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AiOrb state={orbState} size={88} />
            <h2 className="text-3xl font-bold tracking-tight text-frost">Kerai AI</h2>
            <p className="text-sm text-fog">
              Running entirely on your own GPU via Ollama — no cloud, no API keys.
            </p>
          </div>

          {error && !status && (
            <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              Couldn&apos;t read system status: {error}{" "}
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="ml-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-medium text-red-200 hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          )}
          {error && status && (
            <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠ {error}
            </div>
          )}

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            <ActivityCard />
            <AutomationsCard />
          </div>

          {status && (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {status.battery ? (
                <StatCard
                  label="Battery"
                  value={`${status.battery.percent}%`}
                  sub={status.battery.isCharging ? "Charging" : "On battery"}
                  barPercent={status.battery.percent}
                />
              ) : batteryUnavailable ? (
                <StatCard label="Battery" value="—" sub={`⚠ ${batteryUnavailable}`} warn />
              ) : (
                <StatCard label="Battery" value="—" sub="No battery detected (desktop)" />
              )}

              {status.cpu ? (
                <StatCard
                  label="CPU load"
                  value={`${status.cpu.loadPercent}%`}
                  sub={`${status.cpu.brand} · ${status.cpu.cores} cores`}
                  barPercent={status.cpu.loadPercent}
                />
              ) : (
                <StatCard
                  label="CPU load"
                  value="—"
                  sub={`⚠ ${unavailableReason(status, "cpu") ?? "unavailable"}`}
                  warn
                />
              )}

              {status.gpu ? (
                <StatCard
                  label="GPU"
                  value={
                    status.gpu.utilizationPercent !== null
                      ? `${status.gpu.utilizationPercent}%`
                      : status.gpu.vramTotalMb
                        ? `${status.gpu.vramUsedMb ?? 0} / ${status.gpu.vramTotalMb} MB`
                        : "—"
                  }
                  sub={[
                    status.gpu.model,
                    status.gpu.temperatureC !== null ? `${status.gpu.temperatureC}°C` : null,
                    status.gpu.powerDrawW !== null && status.gpu.powerLimitW !== null
                      ? `${status.gpu.powerDrawW}/${status.gpu.powerLimitW}W`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  barPercent={
                    status.gpu.utilizationPercent ??
                    (status.gpu.vramTotalMb && status.gpu.vramUsedMb
                      ? (status.gpu.vramUsedMb / status.gpu.vramTotalMb) * 100
                      : undefined)
                  }
                />
              ) : gpuUnavailable ? (
                <StatCard label="GPU" value="—" sub={`⚠ ${gpuUnavailable}`} warn />
              ) : (
                <StatCard label="GPU" value="—" sub="No GPU detected" />
              )}

              {status.memory ? (
                <StatCard
                  label="Memory"
                  value={`${status.memory.usedGb} / ${status.memory.totalGb} GB`}
                  sub={`${status.memory.usedPercent}% used`}
                  barPercent={status.memory.usedPercent}
                />
              ) : (
                <StatCard
                  label="Memory"
                  value="—"
                  sub={`⚠ ${unavailableReason(status, "memory") ?? "unavailable"}`}
                  warn
                />
              )}

              {status.storage ? (
                <StatCard
                  label="Storage"
                  value={`${status.storage.usedGb} / ${status.storage.totalGb} GB`}
                  sub={`${status.storage.usedPercent}% used · ${status.storage.mount}`}
                  barPercent={status.storage.usedPercent}
                />
              ) : storageUnavailable ? (
                <StatCard label="Storage" value="—" sub={`⚠ ${storageUnavailable}`} warn />
              ) : (
                <StatCard label="Storage" value="—" sub="No disk detected" />
              )}

              {status.ollama ? (
                <StatCard
                  label="Ollama"
                  value="Connected"
                  sub={
                    status.ollama.modelCount > 0
                      ? `${status.ollama.modelCount} model${status.ollama.modelCount === 1 ? "" : "s"} · ${status.ollama.models[0]}`
                      : "Running · no models pulled yet"
                  }
                />
              ) : ollamaUnavailable ? (
                <StatCard label="Ollama" value="—" sub={`⚠ ${ollamaUnavailable}`} warn />
              ) : (
                <StatCard label="Ollama" value="—" sub="Not reachable" warn />
              )}

              <StatCard
                label="Uptime"
                value={formatUptime(status.uptimeSec)}
                sub={status.os ? `${status.os.hostname} · ${status.os.distro}` : "—"}
              />
            </div>
          )}

          {!status && !error && (
            <div className="text-sm text-fog">
              {/* Unreachable in practice — SSR always fills status or initialError — but kept
                  as a final safety net if both somehow come up empty. */}
              Loading system status…
            </div>
          )}
        </div>
      </div>
    </>
  );
}
