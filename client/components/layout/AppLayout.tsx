import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import NotificationBell from "@/components/NotificationBell";
import {
  LayoutGrid,
  MessageSquareText,
  Workflow,
  Blocks,
  ScrollText,
  Settings,
  Menu,
  X,
  Radio,
  EyeOff,
  Zap,
  Server,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Mission Control", href: "/mission-control", icon: Server },
  { label: "Dashboard", href: "/", icon: LayoutGrid },
  { label: "Console", href: "/console", icon: MessageSquareText },
  { label: "Tasks", href: "/tasks", icon: Zap },
  { label: "Workflows", href: "/workflows", icon: Workflow },
  { label: "Automations", href: "/automations", icon: Calendar },
  { label: "Integrations", href: "/integrations", icon: Blocks },
  { label: "Logs", href: "/logs", icon: ScrollText },
  { label: "Settings", href: "/settings", icon: Settings },
];

function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-primary/20 blur-md" />
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full border border-primary/50 bg-background">
          <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--glow-violet))]" />
        </span>
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="font-display text-base font-bold tracking-[0.15em] text-foreground">
            WRAITH
          </p>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            Autonomous System
          </p>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-6">
        <Brand />
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-secondary",
                )}
              />
              {item.label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--glow-violet))]" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mx-3 mb-5 rounded-xl border border-ghost/30 bg-ghost/5 p-3">
        <div className="flex items-center gap-2 text-ghost">
          <EyeOff className="h-3.5 w-3.5" />
          <span className="text-xs font-mono uppercase tracking-wider">Ghost Mode</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Running silent. No visible processes, no traces.
        </p>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const time = useClock();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border bg-sidebar lg:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-white/5"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-2 text-muted-foreground hover:bg-white/5 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 lg:flex">
              <Radio className="h-3 w-3 animate-pulse text-success" />
              <span className="text-xs font-mono uppercase tracking-wider text-success">
                Systems Nominal
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              {time.toLocaleTimeString([], { hour12: false })}
            </span>
            <NotificationBell />
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="hidden text-xs font-medium text-foreground sm:inline">
                Kishan
              </span>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
