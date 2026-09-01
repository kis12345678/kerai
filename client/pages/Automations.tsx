import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Workflow,
  Plus,
  Trash2,
  Clock,
  Loader2,
  Zap,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Automation, Integration } from "@shared/api";

export default function Automations() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [newIntegrationId, setNewIntegrationId] = useState<string>("");

  // ── Fetch data ─────────────────────────────────────────────────

  const { data: automations = [], isLoading } = useQuery<Automation[]>({
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

  // ── Mutations ──────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; trigger: string; integrationId?: string }) => {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create automation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      setCreateOpen(false);
      setNewName("");
      setNewTrigger("");
      setNewIntegrationId("");
      toast.success("Automation created");
    },
    onError: () => toast.error("Failed to create automation"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/automations/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onError: () => toast.error("Failed to toggle automation"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      toast.success("Automation deleted");
    },
    onError: () => toast.error("Failed to delete automation"),
  });

  function handleCreate() {
    if (!newName.trim() || !newTrigger.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      trigger: newTrigger.trim(),
      integrationId: newIntegrationId || undefined,
    });
  }

  const activeCount = automations.filter((a) => a.active).length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/10">
              <Workflow className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Automations</h1>
              <p className="text-sm text-muted-foreground">
                {activeCount} of {automations.length} running
              </p>
            </div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> New Automation
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Automation</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="auto-name">Name</Label>
                  <Input
                    id="auto-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Inbox triage"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auto-trigger">Trigger</Label>
                  <Input
                    id="auto-trigger"
                    value={newTrigger}
                    onChange={(e) => setNewTrigger(e.target.value)}
                    placeholder="e.g. New mail in Outlook"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Integration (optional)</Label>
                  <Select value={newIntegrationId} onValueChange={setNewIntegrationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an integration" />
                    </SelectTrigger>
                    <SelectContent>
                      {integrations.map((int) => (
                        <SelectItem key={int.id} value={int.id}>
                          {int.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newTrigger.trim() || createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-6 w-11 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : automations.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <Workflow className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">No automations yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((auto) => {
              const integration = integrations.find((i) => i.id === auto.integrationId);
              return (
                <div
                  key={auto.id}
                  className={cn(
                    "rounded-xl border bg-card p-4 transition-colors",
                    auto.active ? "border-secondary/30" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          auto.active ? "bg-secondary/10 text-secondary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {auto.active ? <Zap className="h-5 w-5" /> : <Power className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{auto.name}</p>
                        <p className="text-xs text-muted-foreground">{auto.trigger}</p>
                        {integration && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            linked to <span className="font-mono text-secondary">{integration.name}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(auto.updatedAt).toLocaleDateString()}
                      </div>
                      <button
                        onClick={() => toggleMutation.mutate({ id: auto.id, active: !auto.active })}
                        disabled={toggleMutation.isPending}
                        className={cn(
                          "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
                          auto.active ? "bg-secondary" : "bg-muted",
                        )}
                        aria-label={`Toggle ${auto.name}`}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform",
                            auto.active ? "translate-x-5" : "translate-x-0.5",
                          )}
                        />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(auto.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete ${auto.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
