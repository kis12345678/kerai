import { Shell } from "@/components/shell";

// This layout persists across navigation between every route in the (app) group — Dashboard,
// Automations — so Shell (and the ChatPanel it mounts) is instantiated once, not per page.
// That's what lets the chat panel's messages/session survive switching pages instead of
// resetting every time, since it isn't the page tree that owns its state anymore.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
