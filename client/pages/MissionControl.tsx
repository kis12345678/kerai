import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Shield,
  Zap,
  Brain,
  Clock,
  RefreshCw,
  Loader2,
  Server,
  Workflow,
  Calendar,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: typeof Cpu; label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", color)} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold font-display">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ToolRow({ tool }: { tool: { name: string; category: string; provider: string; permissionLevel: number; enabled: boolean } }) {
  const levelColors = ["text-success", "text-blue-400", "text-warning", "text-destructive"];
  return (
    <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
      <div className={cn("h-2 w-2 rounded-full", tool.enabled ? "bg-success" : "bg-muted-foreground")} />
      <span className="flex-1 text-xs font-mono truncate">{tool.name}</span>
      <span className="text-[10px] text-muted-foreground">{tool.category}</span>
      <span className={cn("text-[10px] font-mono", levelColors[tool.permissionLevel] || "text-muted-foreground")}>
        L{tool.permissionLevel}
      </span>
    </div>
  );
}

function EventRow({ event }: { event: { type: string; source: string; severity: string; timestamp: string } }) {
  const severityColors: Record<string, string> = {
    info: "text-blue-400", warn: "text-warning", error: "text-destructive", trace: "text-muted-foreground",
  };
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11px]">
      <span className="text-muted-foreground w-16 shrink-0">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <span className={cn("w-10 shrink-0 uppercase text-[9px] font-bold", severityColors[event.severity] || "text-muted-foreground")}>{event.severity}</span>
      <span className="text-muted-foreground w-20 shrink-0 truncate">{event.source}</span>
      <span className="flex-1 truncate">{event.type}</span>
    </div>
  );
}

export default function MissionControl() {
  const { data: status } = useQuery<{ cpu: number; memory: number; uptime: number; totalMemoryGB: number; toolCount: number; activeProvider: string; activeAutomations: number; connectedIntegrations: number; totalLogs: number; geminiConfigured: boolean }>({
    queryKey: ["status"],
    queryFn: async () => { const r = await fetch("/api/status"); return r.json(); },
    refetchInterval: 3000,
  });

  const { data: toolsData } = useQuery<{ tools: any[] }>({
    queryKey: ["tools-mc"],
    queryFn: async () => { const r = await fetch("/api/tools"); return r.json(); },
  });

  const { data: eventsData } = useQuery<{ events: any[] }>({
    queryKey: ["events-mc"],
    queryFn: async () => { const r = await fetch("/api/events/recent?limit=20"); return r.json(); },
    refetchInterval: 5000,
  });

  const { data: tasksData } = useQuery<{ total: number; byStatus: Record<string, number> }>({
    queryKey: ["tasks-mc"],
    queryFn: async () => { const r = await fetch("/api/tasks/stats"); return r.json(); },
    refetchInterval: 5000,
  });

  const { data: permData } = useQuery<{ totalTools: number; allowedTools: number; blockedTools: number; confirmationRequiredTools: number; overrides: number }>({
    queryKey: ["permissions-mc"],
    queryFn: async () => { const r = await fetch("/api/permissions"); return r.json(); },
  });

  const { data: memData } = useQuery<{ total: number; byLayer: Record<string, number>; active: number; expired: number }>({
    queryKey: ["memory-mc"],
    queryFn: async () => { const r = await fetch("/api/memory/stats"); return r.json(); },
  });

  const { data: schedData } = useQuery<{ schedules: any[]; total: number }>({
    queryKey: ["schedules-mc"],
    queryFn: async () => { const r = await fetch("/api/schedules"); return r.json(); },
  });

  const tools = toolsData?.tools || [];
  const events = eventsData?.events || [];
  const tasks = tasksData || { total: 0, byStatus: {} };
  const mem = memData || { total: 0, byLayer: {}, active: 0, expired: 0 };
  const schedules = schedData?.schedules || [];

  const formatUptime = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Mission Control</h1>
              <p className="text-sm text-muted-foreground">Real-time KERAI system overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-mono text-success">KERAI ONLINE</span>
          </div>
        </div>

        {/* System Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Cpu} label="CPU" value={`${status?.cpu ?? "—"}%`} color="text-primary" />
          <StatCard icon={MemoryStick} label="Memory" value={`${status?.memory ?? "—"}%`} color="text-secondary" sub={status?.totalMemoryGB ? `${status.totalMemoryGB} GB total` : undefined} />
          <StatCard icon={Clock} label="Uptime" value={status?.uptime ? formatUptime(status.uptime) : "—"} color="text-success" />
          <StatCard icon={Activity} label="Logs" value={status?.totalLogs ?? 0} color="text-warning" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column */}
          <div className="space-y-6">
            {/* KERAI Core Status */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold">KERAI Core</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Tools</p>
                  <p className="text-lg font-bold">{status?.toolCount ?? tools.length}</p>
                </div>
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Active Provider</p>
                  <p className="text-lg font-bold capitalize">{status?.activeProvider ?? "—"}</p>
                </div>
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Integrations</p>
                  <p className="text-lg font-bold">{status?.connectedIntegrations ?? 0} linked</p>
                </div>
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Automations</p>
                  <p className="text-lg font-bold">{status?.activeAutomations ?? 0} active</p>
                </div>
              </div>
            </div>

            {/* Permission Status */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-warning" /> Permission Engine
              </h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-success/5 p-2">
                  <p className="text-success font-bold text-lg">{permData?.allowedTools ?? 0}</p>
                  <p className="text-muted-foreground">Allowed</p>
                </div>
                <div className="rounded-lg bg-destructive/5 p-2">
                  <p className="text-destructive font-bold text-lg">{permData?.blockedTools ?? 0}</p>
                  <p className="text-muted-foreground">Blocked</p>
                </div>
                <div className="rounded-lg bg-warning/5 p-2">
                  <p className="text-warning font-bold text-lg">{permData?.confirmationRequiredTools ?? 0}</p>
                  <p className="text-muted-foreground">Need Confirm</p>
                </div>
                <div className="rounded-lg bg-primary/5 p-2">
                  <p className="text-primary font-bold text-lg">{permData?.overrides ?? 0}</p>
                  <p className="text-muted-foreground">Overrides</p>
                </div>
              </div>
            </div>

            {/* Memory Status */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4 text-cyan-400" /> Memory System
              </h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-background/50 p-2">
                  <p className="font-bold text-lg">{mem.total}</p>
                  <p className="text-muted-foreground">Total Entries</p>
                </div>
                <div className="rounded-lg bg-background/50 p-2">
                  <p className="font-bold text-lg">{mem.active}</p>
                  <p className="text-muted-foreground">Active</p>
                </div>
                {(Object.entries(mem.byLayer) as [string, number][]).map(([layer, count]) => (
                  <div key={layer} className="rounded-lg bg-background/50 p-2">
                    <p className="font-bold text-lg">{count}</p>
                    <p className="text-muted-foreground capitalize">{layer.replace("_", " ")}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Task Stats */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Task Engine
              </h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-background/50 p-2">
                  <p className="font-bold text-lg">{tasks.total}</p>
                  <p className="text-muted-foreground">Total Tasks</p>
                </div>
                <div className="rounded-lg bg-success/5 p-2">
                  <p className="text-success font-bold text-lg">{(tasks.byStatus as any)?.completed || 0}</p>
                  <p className="text-muted-foreground">Completed</p>
                </div>
                <div className="rounded-lg bg-primary/5 p-2">
                  <p className="text-primary font-bold text-lg">{(tasks.byStatus as any)?.executing || 0}</p>
                  <p className="text-muted-foreground">Running</p>
                </div>
                <div className="rounded-lg bg-destructive/5 p-2">
                  <p className="text-destructive font-bold text-lg">{(tasks.byStatus as any)?.failed || 0}</p>
                  <p className="text-muted-foreground">Failed</p>
                </div>
              </div>
            </div>

            {/* Schedules */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-secondary" /> Scheduler
              </h2>
              <p className="text-xs text-muted-foreground">{schedules.length} schedule(s) configured</p>
              {schedules.length > 0 && (
                <div className="mt-2 space-y-1">
                  {schedules.slice(0, 5).map((s: any) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <div className={cn("h-1.5 w-1.5 rounded-full", s.enabled ? "bg-success" : "bg-muted-foreground")} />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-muted-foreground">{s.triggerType}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Registered Tools */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold">Registered Tools ({tools.length})</h2>
              <div className="max-h-[300px] space-y-1 overflow-y-auto">
                {tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </div>
            </div>

            {/* Live Event Feed */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-display text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-400" /> Live Events
              </h2>
              <div className="max-h-[400px] overflow-y-auto rounded-lg bg-black/20">
                {events.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">No events yet</p>
                ) : (
                  events.map((event: any, i: number) => (
                    <EventRow key={event.id || i} event={event} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
