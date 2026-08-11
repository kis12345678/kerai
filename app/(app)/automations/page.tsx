"use client";

import { useEffect, useState } from "react";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";

const DEFAULT_WORKSPACE = "G:\\my assistant";

type Automation = {
  id: string;
  label: string;
  prompt: string;
  workspaceRoot: string;
  model: string;
  schedule: { type: "daily"; hhmm: string } | { type: "interval"; everyMinutes: number };
  createdAt: number;
  lastRunAt: number | null;
  lastResult: string | null;
  lastError: string | null;
};

function scheduleText(s: Automation["schedule"]): string {
  return s.type === "daily" ? `Daily at ${s.hhmm}` : `Every ${s.everyMinutes} min`;
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

  async function handleDelete(id: string) {
    await fetch("/api/automations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3 sm:px-6">
        <h1 className="text-sm font-medium text-zinc-300">Automations</h1>
        <span className="ml-auto text-xs text-zinc-500">Read-only tools only — no writes, no commands</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 rounded-xl border border-amber-500/15 bg-white/5 p-4"
          >
            <div className="text-sm font-medium text-zinc-200">New automation</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label, e.g. Morning repo summary"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should it do? e.g. Summarize git log for the last day and note anything that looks unfinished."
              rows={3}
              className="resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <input
                value={workspaceRoot}
                onChange={(e) => setWorkspaceRoot(e.target.value)}
                placeholder="Workspace root"
                className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none"
              />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/40 focus:outline-none"
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
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/40 focus:outline-none"
              >
                <option value="daily">Daily at</option>
                <option value="interval">Every N minutes</option>
              </select>
              {scheduleType === "daily" ? (
                <input
                  type="time"
                  value={hhmm}
                  onChange={(e) => setHhmm(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/40 focus:outline-none"
                />
              ) : (
                <input
                  type="number"
                  min={5}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(Number(e.target.value))}
                  className="w-24 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/40 focus:outline-none"
                />
              )}
              <button
                type="submit"
                disabled={submitting || !label.trim() || !prompt.trim()}
                className="ml-auto rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-medium text-black disabled:opacity-40"
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
            {loading && <div className="text-sm text-zinc-500">Loading…</div>}
            {!loading && automations.length === 0 && (
              <div className="text-sm text-zinc-500">No automations yet.</div>
            )}
            {automations.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{a.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {scheduleText(a.schedule)} · {a.model || "default model"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-400 hover:border-red-500/40 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
                <div className="mt-2 text-xs text-zinc-400">{a.prompt}</div>
                {a.lastRunAt && (
                  <div className="mt-3 rounded-lg bg-black/30 p-2 text-xs">
                    <div className="text-zinc-500">Last ran {new Date(a.lastRunAt).toLocaleString()}</div>
                    {a.lastError ? (
                      <div className="mt-1 text-red-300">{a.lastError}</div>
                    ) : (
                      <div className="mt-1 whitespace-pre-wrap text-zinc-300">{a.lastResult}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
