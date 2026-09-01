import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  ScrollText,
  Trash2,
  Loader2,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogEntry, LogLevel } from "@shared/api";

const LEVEL_CONFIG: Record<LogLevel, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  info: { icon: Info, color: "text-primary", bg: "bg-primary/10" },
  warning: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" },
  error: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
  success: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
};

const LEVELS: LogLevel[] = ["info", "warning", "error", "success"];

export default function Logs() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LogLevel | "all">("all");

  // ── Fetch ──────────────────────────────────────────────────────

  const { data: logs = [], isLoading } = useQuery<LogEntry[]>({
    queryKey: ["logs"],
    queryFn: async () => {
      const res = await fetch("/api/logs");
      return res.json();
    },
    refetchInterval: 3000,
  });

  // ── Clear mutation ─────────────────────────────────────────────

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logs", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear logs");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Logs cleared");
    },
    onError: () => toast.error("Failed to clear logs"),
  });

  const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const levelCounts = LEVELS.reduce(
    (acc, level) => {
      acc[level] = logs.filter((l) => l.level === level).length;
      return acc;
    },
    {} as Record<LogLevel, number>,
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-ghost/30 bg-ghost/10">
              <ScrollText className="h-6 w-6 text-ghost" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Activity Logs</h1>
              <p className="text-sm text-muted-foreground">
                {logs.length} total entries
              </p>
            </div>
          </div>
          <Button
            variant="destructive"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || logs.length === 0}
          >
            {clearMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Clear All
          </Button>
        </div>

        {/* Filters */}
        <div className="mb-6 flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-mono transition-colors",
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            All ({logs.length})
          </button>
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-mono transition-colors",
                filter === level
                  ? `${LEVEL_CONFIG[level].bg} ${LEVEL_CONFIG[level].color}`
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {level} ({levelCounts[level] || 0})
            </button>
          ))}
        </div>

        {/* Log entries */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <ScrollText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              {filter === "all" ? "No logs yet." : `No ${filter} logs.`}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            {/* Terminal header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">wraith-core.log</span>
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              {filteredLogs.map((log) => {
                const cfg = LEVEL_CONFIG[log.level];
                const Icon = cfg.icon;
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-0 hover:bg-muted/30"
                  >
                    <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", cfg.bg)}>
                      <Icon className={cn("h-3 w-3", cfg.color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-[10px] font-mono uppercase tracking-wider", cfg.color)}>
                          {log.level}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">{log.source}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-xs leading-relaxed text-foreground/80">
                        {log.message}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
