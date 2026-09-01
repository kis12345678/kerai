import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Play,
  Pause,
  ChevronDown,
  ChevronRight,
  Trash2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus, TaskStep } from "@shared/api";

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  queued: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted", label: "Queued" },
  planning: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Planning" },
  waiting_for_permission: { icon: Pause, color: "text-yellow-400", bg: "bg-yellow-400/10", label: "Waiting" },
  executing: { icon: Loader2, color: "text-primary", bg: "bg-primary/10", label: "Running" },
  verifying: { icon: CheckCircle, color: "text-cyan-400", bg: "bg-cyan-400/10", label: "Verifying" },
  paused: { icon: Pause, color: "text-yellow-400", bg: "bg-yellow-400/10", label: "Paused" },
  failed: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "Failed" },
  completed: { icon: CheckCircle, color: "text-success", bg: "bg-success/10", label: "Completed" },
  cancelled: { icon: XCircle, color: "text-muted-foreground", bg: "bg-muted", label: "Cancelled" },
};

function formatTime(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function TaskCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.queued;
  const Icon = config.icon;
  const completedSteps = task.steps.filter((s) => s.status === "completed").length;

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", config.bg)}>
          <Icon className={cn("h-4 w-4", config.color, task.status === "executing" && "animate-spin")} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.objective}</p>
          <p className="text-xs text-muted-foreground">
            {config.label} · {completedSteps}/{task.steps.length} steps · {formatTime(task.createdAt)}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-mono uppercase", config.bg, config.color)}>
          {config.label}
        </span>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          {/* Steps */}
          {task.steps.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase text-muted-foreground/60">Steps</p>
              {task.steps.map((step) => {
                const stepConfig = STATUS_CONFIG[step.status] || STATUS_CONFIG.queued;
                const StepIcon = stepConfig.icon;
                return (
                  <div key={step.id} className="flex items-start gap-2 rounded-lg bg-background/50 p-2.5">
                    <StepIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", stepConfig.color, step.status === "executing" && "animate-spin")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{step.description}</p>
                      {step.toolName && (
                        <p className="text-[10px] font-mono text-muted-foreground">{step.toolName}</p>
                      )}
                      {step.result && typeof step.result === "object" && (step.result as any).error && (
                        <p className="text-[10px] text-destructive mt-1">{(step.result as any).error}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{formatDuration(step.result ? (step.result as any).durationMs : undefined)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Result */}
          {task.result && (
            <div className="mt-3 rounded-lg bg-background/50 p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground/60 mb-1">Result</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{task.result}</p>
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div className="mt-3 rounded-lg bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-xs font-medium uppercase text-destructive/60 mb-1">Error</p>
              <p className="text-sm text-destructive whitespace-pre-wrap">{task.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Tasks() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ tasks: Task[]; total: number; byStatus: Record<string, number> }>({
    queryKey: ["tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks?limit=100");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const tasks = data?.tasks || [];
  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  const byStatus = data?.byStatus || {};
  const statusCounts: { label: string; value: string; count: number }[] = [
    { label: "All", value: "all", count: tasks.length },
    { label: "Running", value: "executing", count: byStatus["executing"] || 0 },
    { label: "Completed", value: "completed", count: byStatus["completed"] || 0 },
    { label: "Failed", value: "failed", count: byStatus["failed"] || 0 },
    { label: "Queued", value: "queued", count: byStatus["queued"] || 0 },
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Tasks</h1>
              <p className="text-sm text-muted-foreground">View and manage task execution</p>
            </div>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["tasks"] })}
            className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Status Filter Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {statusCounts.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilter(s.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filter === s.value
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-muted text-muted-foreground hover:text-foreground border border-transparent",
              )}
            >
              {s.label} {s.count > 0 && <span className="ml-1 opacity-60">{s.count}</span>}
            </button>
          ))}
        </div>

        {/* Task List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <Zap className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No tasks yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Send a command in the Console to create a task</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
