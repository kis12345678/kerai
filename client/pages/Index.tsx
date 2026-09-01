import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Mic,
  Send,
  ShieldCheck,
  EyeOff,
  Zap,
  Mail,
  MessageCircle,
  Cloud,
  FileSpreadsheet,
  AppWindow,
  CloudCog,
  FileText,
  Presentation,
  Terminal,
  Workflow,
  Power,
  MonitorCog,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  Automation,
  Integration,
  LogEntry,
  SystemStatus,
  CommandResponse,
} from "@shared/api";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail,
  MessageCircle,
  Cloud,
  FileSpreadsheet,
  AppWindow,
  CloudCog,
  FileText,
  Presentation,
};

const GREETINGS = [
  "Online and listening, Kishan. Try not to leave fingerprints.",
  "All systems nominal. What are we breaking today?",
  "I've been watching your calendar. You're welcome, by the way.",
  "Standing by. Say the word and I'll handle the rest.",
];

const INITIAL_LOG_LINES = [
  "[system] WRAITH core initialized — full device access granted",
  "[voice] wake word engine armed",
  "[ms365] outlook, teams, onedrive, excel synced",
  "[ghost] background mode engaged — zero UI footprint",
];

function useTypedGreeting() {
  const [text, setText] = useState("");
  useEffect(() => {
    const full = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setText(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, []);
  return text;
}

export default function Index() {
  const greeting = useTypedGreeting();
  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [localLog, setLocalLog] = useState(INITIAL_LOG_LINES);
  const logRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // ── Fetch data from backend ────────────────────────────────────

  const { data: status } = useQuery<SystemStatus>({
    queryKey: ["status"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: automations = [] } = useQuery<Automation[]>({
    queryKey: ["automations"],
    queryFn: async () => {
      const res = await fetch("/api/automations");
      return res.json();
    },
  });

  const { data: integrations = [] } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await fetch("/api/integrations");
      return res.json();
    },
  });

  const { data: logs = [] } = useQuery<LogEntry[]>({
    queryKey: ["logs"],
    queryFn: async () => {
      const res = await fetch("/api/logs?limit=15");
      return res.json();
    },
    refetchInterval: 4000,
  });

  // ── Mutations ──────────────────────────────────────────────────

  const sendCommand = useMutation<CommandResponse, Error, string>({
    mutationFn: async (text) => {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Failed to send command");
      return res.json();
    },
    onSuccess: (data) => {
      setLocalLog((prev) => [
        ...prev.slice(-11),
        `[you] ${command}`,
        `[wraith] ${data.text}`,
      ]);
      queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => {
      toast.error("Failed to send command. Please try again.");
    },
  });

  const toggleAutomation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/automations/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error("Failed to toggle automation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onError: () => {
      toast.error("Failed to toggle automation");
    },
  });

  // Emergency shutdown — deactivate all automations + clear logs
  const emergencyShutdown = useMutation({
    mutationFn: async () => {
      // Deactivate all active automations
      const activeAutos = automations.filter((a) => a.active);
      await Promise.all(
        activeAutos.map((a) =>
          fetch(`/api/automations/${a.id}/toggle`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: false }),
          })
        )
      );
      // Clear all logs
      await fetch("/api/logs", { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Emergency shutdown complete — all automations stopped, logs cleared");
    },
    onError: () => {
      toast.error("Emergency shutdown failed");
    },
  });

  // ── Effects ────────────────────────────────────────────────────

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [localLog, logs]);

  // ── Handlers ──────────────────────────────────────────────────

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    sendCommand.mutate(command.trim());
    setCommand("");
  }

  function handleToggleAutomation(id: string, currentActive: boolean) {
    toggleAutomation.mutate({ id, active: !currentActive });
  }

  // Merge backend logs with local log for display
  const displayLog = [
    ...localLog,
    ...logs.map((l) => `[${l.source}] ${l.message}`),
  ].slice(-15);

  const connectedCount = integrations.filter((i) => i.status === "connected").length;
  const activeAutoCount = automations.filter((a) => a.active).length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Gemini warning */}
        {status && status.geminiConfigured === false && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-warning">GEMINI_API_KEY not configured</p>
              <p className="text-xs text-muted-foreground">WRAITH is running in fallback mode. Add your Gemini API key to <code className="font-mono">.env</code> for full AI capabilities.</p>
            </div>
          </div>
        )}

        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black,transparent)]" />
          <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="relative mx-auto flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48">
              <span className="absolute h-full w-full animate-orb-ring rounded-full border border-primary/50" />
              <span className="absolute h-full w-full animate-orb-ring rounded-full border border-secondary/40 [animation-delay:1.2s]" />
              <span className="absolute h-28 w-28 rounded-full bg-primary/30 blur-2xl sm:h-32 sm:w-32" />
              <span className="relative flex h-28 w-28 animate-orb-pulse items-center justify-center rounded-full border border-primary/60 bg-gradient-to-br from-primary/40 via-secondary/20 to-transparent sm:h-32 sm:w-32">
                <span className="flex gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-1 animate-wave-bar rounded-full bg-foreground"
                      style={{
                        height: "28px",
                        animationDelay: `${i * 0.12}s`,
                        opacity: listening ? 1 : 0.5,
                      }}
                    />
                  ))}
                </span>
              </span>
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ghost/30 bg-ghost/10 px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-ghost">
                  <EyeOff className="h-3 w-3" /> Ghost Active
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-3 w-3" /> Full Access
                </span>
              </div>
              <h1 className="font-display text-3xl font-bold sm:text-4xl">
                Hey Kishan. <span className="text-primary text-glow-violet">WRAITH</span> is with you.
              </h1>
              <p className="mt-2 min-h-[1.75rem] font-mono text-sm text-muted-foreground">
                {greeting}
                <span className="ml-0.5 inline-block h-4 w-[2px] animate-blink bg-primary align-middle" />
              </p>

              <form onSubmit={handleSubmit} className="mt-6 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setListening((v) => !v)}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors",
                    listening
                      ? "border-primary bg-primary/20 text-primary shadow-[0_0_20px_hsl(var(--glow-violet)/0.5)]"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                  aria-label="Toggle voice listening"
                >
                  <Mic className="h-5 w-5" />
                </button>
                <div className="flex flex-1 items-center rounded-full border border-border bg-background/60 px-4">
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={listening ? "Listening..." : "Tell WRAITH what to do..."}
                    className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="submit"
                    disabled={sendCommand.isPending}
                    className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:opacity-50"
                    aria-label="Send command"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "System Access", value: "Full Control", icon: MonitorCog, tone: "text-primary" },
            { label: "Ghost Mode", value: "Active", icon: EyeOff, tone: "text-ghost" },
            { label: "Automations", value: `${activeAutoCount} running`, icon: Workflow, tone: "text-secondary" },
            { label: "MS 365 Sync", value: `${connectedCount} of ${integrations.length} linked`, icon: Zap, tone: "text-warning" },
          ].map((s) => (
            <div key={s.label} className="glass-panel rounded-xl p-4">
              <s.icon className={cn("h-4 w-4", s.tone)} />
              <p className="mt-3 text-lg font-semibold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Integrations */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Microsoft &amp; Tool Access</h2>
              <span className="text-xs font-mono text-muted-foreground">{integrations.length} tools</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {integrations.map((tool) => {
                const IconComp = ICON_MAP[tool.icon] || AppWindow;
                return (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <IconComp className="h-5 w-5 text-secondary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{tool.name}</p>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono uppercase tracking-wider",
                        tool.status === "connected"
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          tool.status === "connected" ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                      {tool.status === "connected" ? "linked" : tool.status}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mb-3 mt-8 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Automations</h2>
              <span className="text-xs font-mono text-muted-foreground">
                {activeAutoCount}/{automations.length} active
              </span>
            </div>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {automations.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.trigger}</p>
                  </div>
                  <button
                    onClick={() => handleToggleAutomation(a.id, a.active)}
                    disabled={toggleAutomation.isPending}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
                      a.active ? "bg-primary" : "bg-muted",
                    )}
                    aria-label={`Toggle ${a.name}`}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform",
                        a.active ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Activity log */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Live Activity</h2>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ["logs"] })}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Refresh logs"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-xl border border-border bg-black/40">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  wraith-core.log
                </span>
              </div>
              <div
                ref={logRef}
                className="h-[420px] space-y-1.5 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed"
              >
                {displayLog.map((line, i) => (
                  <p
                    key={i}
                    className={cn(
                      "animate-fade-up",
                      line.startsWith("[you]")
                        ? "text-secondary"
                        : line.startsWith("[wraith]")
                          ? "text-primary"
                          : "text-muted-foreground",
                    )}
                  >
                    {line}
                  </p>
                ))}
                <span className="inline-block h-3 w-1.5 animate-blink bg-primary" />
              </div>
            </div>

            <button
              onClick={() => emergencyShutdown.mutate()}
              disabled={emergencyShutdown.isPending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              <Power className="h-4 w-4" /> {emergencyShutdown.isPending ? "Shutting down..." : "Emergency shutdown"}
            </button>
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
