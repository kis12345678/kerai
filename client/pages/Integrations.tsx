import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import {
  Blocks,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  LinkIcon,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail,
  MessageCircle,
  Cloud,
  FileSpreadsheet,
  AppWindow,
  CloudCog,
  FileText,
  Presentation,
} from "lucide-react";
import type { Integration, IntegrationStatus } from "@shared/api";

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

const STATUS_CONFIG: Record<IntegrationStatus, { label: string; color: string; bg: string }> = {
  connected: { label: "Connected", color: "text-success", bg: "bg-success/10 border-success/30" },
  disconnected: { label: "Disconnected", color: "text-muted-foreground", bg: "bg-muted" },
  error: { label: "Error", color: "text-destructive", bg: "bg-destructive/10 border-destructive/30" },
  idle: { label: "Idle", color: "text-muted-foreground", bg: "bg-muted" },
};

export default function Integrations() {
  const queryClient = useQueryClient();

  // ── Fetch ──────────────────────────────────────────────────────

  const { data: integrations = [], isLoading } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await fetch("/api/integrations");
      return res.json();
    },
  });

  // ── Mutations ──────────────────────────────────────────────────

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: IntegrationStatus }) => {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update integration");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      toast.success("Integration updated");
    },
    onError: () => toast.error("Failed to update integration"),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/integrations/${id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Sync completed");
    },
    onError: () => toast.error("Sync failed"),
  });

  const connectedCount = integrations.filter((i) => i.status === "connected").length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Blocks className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Integrations</h1>
            <p className="text-sm text-muted-foreground">
              {connectedCount} of {integrations.length} connected
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["connected", "idle", "disconnected", "error"] as const).map((status) => {
            const count = integrations.filter((i) => i.status === status).length;
            const cfg = STATUS_CONFIG[status];
            return (
              <div key={status} className={cn("rounded-lg border p-3 text-center", cfg.bg)}>
                <p className={cn("text-lg font-semibold", cfg.color)}>{count}</p>
                <p className="text-xs text-muted-foreground">{cfg.label}</p>
              </div>
            );
          })}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map((int) => {
              const IconComp = ICON_MAP[int.icon] || AppWindow;
              const cfg = STATUS_CONFIG[int.status];
              const isSyncing = syncMutation.isPending;

              return (
                <div
                  key={int.id}
                  className={cn(
                    "rounded-xl border bg-card p-4 transition-colors",
                    int.status === "connected" ? "border-success/20" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <IconComp className="h-5 w-5 text-secondary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{int.name}</p>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                            cfg.bg,
                            cfg.color,
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", int.status === "connected" ? "bg-success" : "bg-muted-foreground")} />
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{int.description}</p>
                      {int.lastSyncedAt && (
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Last synced {new Date(int.lastSyncedAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {int.status === "connected" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncMutation.mutate(int.id)}
                          disabled={isSyncing}
                        >
                          {isSyncing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Sync
                        </Button>
                      )}
                      <Button
                        variant={int.status === "connected" ? "destructive" : "outline"}
                        size="sm"
                        onClick={() =>
                          toggleStatus.mutate({
                            id: int.id,
                            status: int.status === "connected" ? "disconnected" : "connected",
                          })
                        }
                        disabled={toggleStatus.isPending}
                      >
                        {int.status === "connected" ? (
                          <>
                            <Unlink className="h-3.5 w-3.5" /> Disconnect
                          </>
                        ) : (
                          <>
                            <LinkIcon className="h-3.5 w-3.5" /> Connect
                          </>
                        )}
                      </Button>
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
