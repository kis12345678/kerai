"use client";

import { useEffect, useState } from "react";
import { AiOrb } from "@/components/ai-orb";

type GpuStatus = {
  model: string;
  vendor: string;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  utilizationPercent: number | null;
  temperatureC: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
};

type SystemStatus = {
  battery: {
    hasBattery: boolean;
    percent?: number;
    isCharging?: boolean;
    timeRemainingMin?: number | null;
  };
  cpu: { manufacturer: string; brand: string; cores: number; loadPercent: number };
  memory: { totalGb: number; usedGb: number; usedPercent: number };
  os: { platform: string; distro: string; hostname: string };
  gpu: GpuStatus | null;
  uptimeSec: number;
};

const POLL_MS = 5000;

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatCard({
  label,
  value,
  sub,
  barPercent,
}: {
  label: string;
  value: string;
  sub?: string;
  barPercent?: number;
}) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-white/5 p-4 transition-colors hover:border-amber-500/30">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
      {barPercent !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/system-status");
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as SystemStatus;
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const orbState =
    status && (status.cpu.loadPercent > 60 || (status.gpu?.utilizationPercent ?? 0) > 60)
      ? "thinking"
      : "idle";

  return (
    <>
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
        <h1 className="text-sm font-medium text-zinc-300">Dashboard</h1>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Live · refreshes every {POLL_MS / 1000}s
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AiOrb state={orbState} size={88} />
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">OmniAI</h2>
            <p className="text-sm text-zinc-500">
              Running entirely on your own GPU via Ollama — no cloud, no API keys.
            </p>
          </div>

          {error && (
            <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              Couldn&apos;t read system status: {error}
            </div>
          )}

          {status && (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {status.battery.hasBattery ? (
                <StatCard
                  label="Battery"
                  value={`${status.battery.percent}%`}
                  sub={status.battery.isCharging ? "Charging" : "On battery"}
                  barPercent={status.battery.percent}
                />
              ) : (
                <StatCard label="Battery" value="—" sub="No battery detected (desktop)" />
              )}
              <StatCard
                label="CPU load"
                value={`${status.cpu.loadPercent}%`}
                sub={`${status.cpu.brand} · ${status.cpu.cores} cores`}
                barPercent={status.cpu.loadPercent}
              />
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
              ) : (
                <StatCard label="GPU" value="—" sub="No GPU detected" />
              )}
              <StatCard
                label="Memory"
                value={`${status.memory.usedGb} / ${status.memory.totalGb} GB`}
                sub={`${status.memory.usedPercent}% used`}
                barPercent={status.memory.usedPercent}
              />
              <StatCard label="Uptime" value={formatUptime(status.uptimeSec)} sub={status.os.hostname} />
            </div>
          )}

          {!status && !error && <div className="text-sm text-zinc-500">Reading system status…</div>}
        </div>
      </div>
    </>
  );
}
