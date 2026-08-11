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
      // Hard navigation, not router.replace/refresh: this app is fully client-rendered past
      // the auth gate, and a soft transition out of this useSearchParams+Suspense page was
      // reproducibly triggering React's "Maximum update depth exceeded" loop.
      window.location.href = searchParams.get("next") || "/dashboard";
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-zinc-950 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <AiOrb state="idle" size={64} />
          <span className="text-sm font-semibold tracking-tight">OmniAI</span>
        </div>
        <label className="mb-1.5 block text-xs text-zinc-500">Password</label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
        />
        {error && <div className="mb-3 text-xs text-red-300">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-opacity disabled:opacity-40"
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
