import { registerDevice, listDevices, revokeDevice, isDeviceConnected } from "@/lib/android-agent";

// Device management, called from the dashboard UI (which is behind whatever gates the app
// itself). Registering returns the token exactly once — it is never retrievable afterwards.
const WORKSPACE = process.env.OMNIAI_WORKSPACE?.trim() || process.cwd();

export async function GET() {
  const devices = await listDevices(WORKSPACE);
  return Response.json({
    devices: devices.map((d) => ({ ...d, connected: isDeviceConnected(d.id) })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const { id, token } = await registerDevice(WORKSPACE, body.name ?? "Android device");
  // The plaintext token is in this response and nowhere else — the caller must save it now.
  return Response.json({ id, token });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing device id" }, { status: 400 });
  const removed = await revokeDevice(WORKSPACE, id);
  return Response.json({ removed });
}
