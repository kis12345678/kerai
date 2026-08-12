import { getSystemSnapshot, type SystemSnapshot } from "@/lib/system-snapshot";
import DashboardClient from "@/components/dashboard-client";

// This page reads live machine state at request time and must never be baked into a static
// prerender — otherwise a production build would freeze build-time telemetry into the HTML.
export const dynamic = "force-dynamic";

// SSR must ALWAYS put something real in the HTML — telemetry, or a clear offline banner when
// the snapshot itself blows up — never a loading placeholder a non-JS reader could mistake for
// a broken page. The snapshot is bounded by per-probe timeouts (~4s worst case), so waiting for
// it costs at most that; the client polls every 5s to keep it fresh afterwards.
export default async function DashboardPage() {
  let snapshot: SystemSnapshot | null = null;
  let snapshotError: string | null = null;
  try {
    snapshot = await getSystemSnapshot();
  } catch (err) {
    snapshotError = (err as Error)?.message ?? "unknown error";
  }

  return <DashboardClient initial={snapshot} initialError={snapshotError} />;
}
