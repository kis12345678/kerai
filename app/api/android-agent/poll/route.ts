import { authenticateDevice, nextCommand } from "@/lib/android-agent";

export const maxDuration = 40;

const WORKSPACE = process.env.OMNIAI_WORKSPACE?.trim() || process.cwd();

function bearer(req: Request): string | undefined {
  return req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
}

/**
 * The companion app long-polls this for its next command. Held open up to ~25s so a command
 * dispatched from the agent reaches the phone near-instantly, without a busy polling loop.
 */
export async function GET(req: Request) {
  const device = await authenticateDevice(WORKSPACE, bearer(req));
  if (!device) {
    return Response.json({ error: "Unauthorized device" }, { status: 401 });
  }
  const command = await nextCommand(device.id);
  return Response.json({ command });
}
