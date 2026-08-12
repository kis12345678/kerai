"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AiOrb } from "@/components/ai-orb";

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        setSubmitting(false);
        return;
      }
      // Only accept a same-site target: `next` is normally written by the proxy from the
      // requested path, but it's query-controllable, and redirecting a freshly logged-in user
      // off-host would be a classic open redirect. A single leading "/" (and not "//", which
      // is a protocol-relative URL to another origin) means it stays on this host.
      const rawNext = searchParams.get("next");
      const safeNext = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
      // Hard navigation, not router.replace/refresh: this app is fully client-rendered past
      // the auth gate, and a soft transition out of this useSearchParams+Suspense page was
      // reproducibly triggering React's "Maximum update depth exceeded" loop.
      window.location.href = safeNext;
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-ink text-frost">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6 shadow-lg shadow-black/40"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <AiOrb state="idle" size={64} />
          <span className="text-sm font-semibold tracking-tight">Kerai AI</span>
        </div>
        <label className="mb-1.5 block text-xs text-fog">Password</label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-xl border border-edge bg-ink/60 px-3 py-2.5 text-sm text-frost outline-none placeholder:text-fog/60 focus:border-accent/60"
        />
        {error && <div className="mb-3 text-xs text-red-300">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-xl bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-ink shadow-accent transition-all hover:brightness-110 disabled:opacity-40"
        >
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
