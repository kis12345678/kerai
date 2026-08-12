import { getSystemSnapshot } from "@/lib/system-snapshot";

// Every probe inside the snapshot runs under its own timeout, so this endpoint has a hard upper
// bound (roughly the slowest probe, ~4s for GPU) and always returns a complete shape — per-metric
// failures come back as `null` value + reason in `errors`, never as a hung or broken request.
export async function GET() {
  return Response.json(await getSystemSnapshot());
}
