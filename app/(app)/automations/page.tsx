"use client";

import { useEffect, useState } from "react";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";

const DEFAULT_WORKSPACE = "G:\\my assistant";

type RunRecord = {
  at: number;
  result: string | null;
  error: string | null;
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
  runs: RunRecord[];
};

type Schedule = Automation["schedule"];

function scheduleText(s: Schedule): string {
  return s.type === "daily" ? `Daily at ${s.hhmm}` : `Every ${s.everyMinutes} min`;
}

function AutomationCard({
  automation,
  onRefresh,
  onError,
}: {
  automation: Automation;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(automation.label);
  const [prompt, setPrompt] = useState(automation.prompt);
  const [workspaceRoot, setWorkspaceRoot] = useState(automation.workspaceRoot);
  const [model, setModel] = useState(automation.model || DEFAULT_MODEL);
  const [schedule, setSchedule] = useState<Schedule>(automation.schedule);
  const [saving, setSaving] = useState(false);

  async function handleRunNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/automations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: automation.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onError(data.error ?? `Status ${res.status}`);
      }
      await onRefresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleToggleEnabled() {
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: automation.id, enabled: !automation.enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `Status ${res.status}`);
      await onRefresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: automation.id, label, prompt, workspaceRoot, model, schedule }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `Status ${res.status}`);
      setEditing(false);
      await onRefresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${automation.enabled ? "border-edge bg-surface" : "border-edge/60 bg-surface/40 opacity-70"}`}>
      {editing ? (
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-2.5">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-frost placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt"
            rows={3}
            className="resize-none rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-frost placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <input
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              className="min-w-[12rem] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
            />
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={schedule.type}
              onChange={(e) =>
                setSchedule(
                  e.target.value === "daily" ? { type: "daily", hhmm: "09:00" } : { type: "interval", everyMinutes: 60 }
                )
              }
              className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
            >
              <option value="daily">Daily at</option>
              <option value="interval">Every N minutes</option>
            </select>
            {schedule.type === "daily" ? (
              <input
                type="time"
                value={schedule.hhmm}
                onChange={(e) => setSchedule({ type: "daily", hhmm: e.target.value })}
                className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
              />
            ) : (
              <input
                type="number"
                min={5}
                value={schedule.everyMinutes}
                onChange={(e) => setSchedule({ type: "interval", everyMinutes: Number(e.target.value) })}                  className="w-24 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
              />
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs text-frost/75 hover:bg-edge"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !label.trim() || !prompt.trim()}
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink shadow-accent transition-all hover:brightness-110 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${automation.enabled ? "bg-accent" : "bg-fog/40"}`}
                  title={automation.enabled ? "Active" : "Paused"}
                />
                <div className="truncate text-sm font-medium text-frost">{automation.label}</div>
              </div>
              <div className="mt-0.5 text-xs text-fog">
                {scheduleText(automation.schedule)} · {automation.model || "default model"}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <button
                onClick={handleRunNow}
                disabled={running}
                className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                title="Run this automation once right now"
              >
                {running ? "Running…" : "▶ Run now"}
              </button>
              <button
                onClick={handleToggleEnabled}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${
                  automation.enabled
                    ? "border-edge bg-surface text-frost/75 hover:bg-edge"
                    : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
                }`}
                title={automation.enabled ? "Pause this automation" : "Resume this automation"}
              >
                {automation.enabled ? "⏸ Pause" : "▶ Resume"}
              </button>
              <button
                onClick={() => {
                  // Re-seed from the current automation so Cancel never leaves a stale draft
                  // and external changes are picked up.
                  setLabel(automation.label);
                  setPrompt(automation.prompt);
                  setWorkspaceRoot(automation.workspaceRoot);
                  setModel(automation.model || DEFAULT_MODEL);
                  setSchedule(automation.schedule);
                  setEditing(true);
                }}
                className="rounded-md border border-edge bg-surface px-2 py-1 text-xs text-frost/75 hover:bg-edge"
                title="Edit this automation"
              >
                ✏️ Edit
              </button>
              <DeleteButton id={automation.id} onRefresh={onRefresh} onError={onError} />
            </div>
          </div>
          <div className="mt-2 text-xs text-fog">{automation.prompt}</div>

          {automation.runs.length > 0 && (
            <details className="mt-3 rounded-lg bg-ink/60 p-2 text-xs">
              <summary className="cursor-pointer list-none text-fog marker:content-none hover:text-frost">
                <span className="mr-1">🕘</span>
                Last ran{" "}
                {new Date(automation.lastRunAt ?? automation.runs[automation.runs.length - 1].at).toLocaleString()}
                {automation.lastError ? " — failed" : " — succeeded"} · {automation.runs.length} run
                {automation.runs.length === 1 ? "" : "s"} in history
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {automation.runs
                  .slice()
                  .reverse()
                  .map((run) => (
                    <div key={run.at} className="rounded-md border border-edge bg-ink/50 p-2">
                      <div className="text-fog">{new Date(run.at).toLocaleString()}</div>
                      {run.error ? (
                        <div className="mt-1 whitespace-pre-wrap text-red-300">{run.error}</div>
                      ) : (
                        <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-frost/75">{run.result}</div>
                      )}
                    </div>
                  ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function DeleteButton({
  id,
  onRefresh,
  onError,
}: {
  id: string;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 2500);
      return;
    }
    try {
      await fetch("/api/automations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await onRefresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }
  return (
    <button
      onClick={handleDelete}
      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
        confirming
          ? "border-red-500/50 bg-red-500/20 text-red-200"
          : "border-edge bg-surface text-fog hover:border-red-500/40 hover:text-red-300"
      }`}
      title={confirming ? "Click again to confirm" : "Delete this automation"}
    >
      {confirming ? "Sure?" : "Delete"}
    </button>
  );
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState(DEFAULT_WORKSPACE);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [scheduleType, setScheduleType] = useState<"daily" | "interval">("daily");
  const [hhmm, setHhmm] = useState("09:00");
  const [everyMinutes, setEveryMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  async function fetchAutomations(): Promise<Automation[]> {
    const res = await fetch("/api/automations");
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return data.automations;
  }

  async function refresh() {
    try {
      setAutomations(await fetchAutomations());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function poll() {
      try {
        setAutomations(await fetchAutomations());
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    poll();
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !prompt.trim()) return;
    setSubmitting(true);
    try {
      const schedule =
        scheduleType === "daily" ? { type: "daily" as const, hhmm } : { type: "interval" as const, everyMinutes };
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, prompt, workspaceRoot, model, schedule }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `Status ${res.status}`);
      setLabel("");
      setPrompt("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-edge px-4 py-3 sm:px-6">
        <h1 className="text-sm font-medium text-frost/75">Automations</h1>
        <span className="ml-auto text-xs text-fog">Read-only tools only — no writes, no commands</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 rounded-xl border border-accent/15 bg-surface p-4"
          >
            <div className="text-sm font-medium text-frost/90">New automation</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label, e.g. Morning repo summary"
              className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-frost placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should it do? e.g. Summarize git log for the last day and note anything that looks unfinished."
              rows={3}
              className="resize-none rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-frost placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <input
                value={workspaceRoot}
                onChange={(e) => setWorkspaceRoot(e.target.value)}
                placeholder="Workspace root"
                className="min-w-[12rem] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
              />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as "daily" | "interval")}
                className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
              >
                <option value="daily">Daily at</option>
                <option value="interval">Every N minutes</option>
              </select>
              {scheduleType === "daily" ? (
                <input
                  type="time"
                  value={hhmm}
                  onChange={(e) => setHhmm(e.target.value)}
                  className="rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
                />
              ) : (
                <input
                  type="number"
                  min={5}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(Number(e.target.value))}
                  className="w-24 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-frost focus:border-accent/60 focus:outline-none"
                />
              )}
              <button
                type="submit"
                disabled={submitting || !label.trim() || !prompt.trim()}
                className="ml-auto rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink shadow-accent transition-all hover:brightness-110 disabled:opacity-40"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {loading && <div className="text-sm text-fog">Loading…</div>}
            {!loading && automations.length === 0 && (
              <div className="text-sm text-fog">No automations yet.</div>
            )}
            {automations.map((a) => (
              <AutomationCard key={a.id} automation={a} onRefresh={refresh} onError={setError} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
