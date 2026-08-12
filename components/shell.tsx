"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";
import { isLoopbackHost } from "@/lib/loopback";

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
      className="shrink-0 rounded-lg border border-edge bg-surface p-2 text-frost/75 hover:bg-edge md:hidden"
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

// Clears the session cookie and returns to the login page. Only meaningful when the app is
// reached through the tunnel — on localhost the proxy exempts loopback and there's no gate.
function LogoutButton() {
  const [isRemote, setIsRemote] = useState(false);

  // Computed after mount (not during render) so server and client agree on the initial state —
  // the hostname is only known on the client, and SSR must render the same tree as hydration.
  // Same predicate the auth gate uses (lib/loopback.ts), so the button's visibility can never
  // drift from whether the gate actually applies.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsRemote(!isLoopbackHost(window.location.hostname));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  if (!isRemote) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await fetch("/api/login", { method: "DELETE" });
        } catch {
          // cookie may still be cleared on next navigation regardless — proceed to login
        }
        // Hard navigation is deliberate: it drops the client's in-memory chat state, which a
        // soft router push would keep alive. Same pattern the login page itself uses.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
      }}
      className="mt-3 rounded-lg border border-edge bg-surface px-3 py-2 text-left text-xs font-medium text-fog transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
    >
      Log out
    </button>
  );
}

function TopNav() {
  const pathname = usePathname();
  return (        <nav className="mb-3 flex gap-1 rounded-lg border border-edge bg-surface p-1">
      {NAV_LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
              active ? "bg-accent/15 text-accent" : "text-fog hover:bg-edge hover:text-frost"
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

  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      <div className="flex h-dvh w-full bg-ink text-frost">
        {open && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-edge bg-ink p-4 transition-transform duration-200 ease-out md:static md:z-auto md:w-56 md:translate-x-0 md:bg-ink/85 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-accent shadow-accent" />
              <span className="text-sm font-semibold tracking-tight">Kerai AI</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close sidebar"
              className="rounded-md p-1 text-fog/60 hover:bg-edge hover:text-frost md:hidden"
            >
              ✕
            </button>
          </div>

          <TopNav />

          <button
            onClick={() => setChatOpen((v) => !v)}
            className={`mb-3 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
              chatOpen
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-edge bg-surface text-frost/75 hover:bg-edge"
            }`}
          >
            💬 {chatOpen ? "Close chat panel" : "Open chat panel"}
          </button>

          <div className="mt-auto rounded-lg border border-edge bg-surface p-3 text-xs text-fog">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-frost/75">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Running locally
            </div>
            All inference runs on your GPU via Ollama. No cloud API calls, no keys, no cost.
          </div>

          <LogoutButton />

        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col">
          {children}

          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
              className="absolute bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg text-accent-ink shadow-accent transition-transform hover:scale-105"
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
