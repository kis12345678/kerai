"use client";

import { createContext, useContext, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";

const SidebarContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(
  null
);

export function SidebarToggle() {
  const ctx = useContext(SidebarContext);
  if (!ctx) return null;
  return (
    <button
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-label="Toggle sidebar"
      className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 hover:bg-white/10 md:hidden"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
      </svg>
    </button>
  );
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/automations", label: "Automations" },
];

function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-3 flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
      {NAV_LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
              active ? "bg-amber-500/15 text-amber-300" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const router = useRouter();

  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      <div className="flex h-dvh w-full bg-zinc-950 text-zinc-100">
        {open && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-white/10 bg-zinc-950 p-4 transition-transform duration-200 ease-out md:static md:z-auto md:w-56 md:translate-x-0 md:bg-zinc-950/80 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-amber-400 to-orange-600" />
              <span className="text-sm font-semibold tracking-tight">OmniAI</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close sidebar"
              className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 md:hidden"
            >
              ✕
            </button>
          </div>

          <TopNav />

          <button
            onClick={() => setChatOpen((v) => !v)}
            className={`mb-3 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
              chatOpen
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            💬 {chatOpen ? "Close chat panel" : "Open chat panel"}
          </button>

          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-zinc-400">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Running locally
            </div>
            All inference runs on your GPU via Ollama. No cloud API calls, no keys, no cost.
          </div>

          <button
            onClick={async () => {
              await fetch("/api/login", { method: "DELETE" });
              router.push("/login");
              router.refresh();
            }}
            className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            Log out
          </button>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col">
          {children}

          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
              className="absolute bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-600 text-lg shadow-lg shadow-amber-900/40 transition-transform hover:scale-105"
            >
              💬
            </button>
          )}
        </main>

        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </SidebarContext.Provider>
  );
}
