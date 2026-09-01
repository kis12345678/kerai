import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Workflow,
  Play,
  Pause,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Settings,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Workflow as WorkflowType } from "@/../../server/lib/workflows";

function formatTime(ts?: string) {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function WorkflowCard({ wf }: { wf: WorkflowType }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workflows/${wf.id}/toggle`, { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success(`Workflow ${wf.enabled ? "disabled" : "enabled"}`);
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workflows/${wf.id}/run`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow executed successfully");
    },
    onError: (err: Error) => {
      toast.error(`Workflow failed: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/workflows/${wf.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow deleted");
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/30">
      <div className="flex items-center gap-3 p-4">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            wf.enabled ? "bg-success/10" : "bg-muted"
          )}>
            <Workflow className={cn("h-4 w-4", wf.enabled ? "text-success" : "text-muted-foreground")} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{wf.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {wf.description || "No description"} · {wf.steps.length} steps · {wf.triggerType}
            </p>
          </div>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || !wf.enabled}
            className="rounded-lg p-1.5 text-success hover:bg-success/10 disabled:opacity-30"
            title="Run workflow"
          >
            {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            title={wf.enabled ? "Disable" : "Enable"}
          >
            {wf.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => { if (confirm("Delete this workflow?")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          {/* Steps */}
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium uppercase text-muted-foreground/60">Steps</p>
            {wf.steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2 rounded-lg bg-background/50 p-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-mono text-primary">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{step.description}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{step.toolName}</p>
                </div>
                {step.condition && (
                  <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">conditional</span>
                )}
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span>Runs: {wf.runCount}</span>
            <span>Last: {formatTime(wf.lastRunAt)}</span>
            <span>Created: {formatTime(wf.createdAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function NewWorkflowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<Array<{ description: string; toolName: string; input: string }>>([
    { description: "", toolName: "", input: "{}" },
  ]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          triggerType: "manual",
          steps: steps.map((s, i) => ({
            id: `step-${i + 1}`,
            order: i + 1,
            description: s.description,
            toolName: s.toolName,
            input: JSON.parse(s.input || "{}"),
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow created");
      onClose();
      setName(""); setDescription(""); setSteps([{ description: "", toolName: "", input: "{}" }]);
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="font-display text-lg font-bold">New Workflow</h2>
        <p className="text-sm text-muted-foreground mt-1">Create a reusable multi-step automation</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning briefing"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workflow does"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Steps</label>
              <button onClick={() => setSteps([...steps, { description: "", toolName: "", input: "{}" }])}
                className="text-xs text-primary hover:text-primary/80">+ Add step</button>
            </div>
            <div className="mt-2 space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-mono text-primary mt-1">{i + 1}</span>
                  <div className="flex-1 space-y-1">
                    <input value={step.description} onChange={(e) => { const s = [...steps]; s[i].description = e.target.value; setSteps(s); }}
                      placeholder="Description" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/50" />
                    <input value={step.toolName} onChange={(e) => { const s = [...steps]; s[i].toolName = e.target.value; setSteps(s); }}
                      placeholder="Tool name (e.g. system.get_status)" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono outline-none focus:border-primary/50" />
                  </div>
                  {steps.length > 1 && (
                    <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive mt-1">×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Workflows() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading } = useQuery<{ workflows: WorkflowType[]; total: number }>({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await fetch("/api/workflows");
      return res.json();
    },
  });

  const workflows = data?.workflows || [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-success/30 bg-success/10">
              <Workflow className="h-5 w-5 text-success" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Workflows</h1>
              <p className="text-sm text-muted-foreground">Reusable multi-step automations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ["workflows"] })}
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <Workflow className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No workflows yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Create your first workflow to automate multi-step tasks</p>
            <button onClick={() => setShowNew(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Create Workflow
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <WorkflowCard key={wf.id} wf={wf} />
            ))}
          </div>
        )}

        <NewWorkflowDialog open={showNew} onClose={() => setShowNew(false)} />
      </div>
    </AppLayout>
  );
}
