import { Shell } from "@/components/shell";
import { ActivityProvider } from "@/components/activity-context";

// This layout persists across navigation between every route in the (app) group — Dashboard,
// Automations — so Shell (and the ChatPanel it mounts) is instantiated once, not per page.
// That's what lets the chat panel's messages/session survive switching pages instead of
// resetting every time, since it isn't the page tree that owns its state anymore.
//
// ActivityProvider is the same story for live task state: the ChatPanel reports which agent is
// working and which tool it's running, and any page (the Dashboard's Live Activity card) can
// read it — the provider outlives page navigation.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActivityProvider>
      <Shell>{children}</Shell>
    </ActivityProvider>
  );
}
