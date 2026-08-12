import { authenticateDevice, submitResult, type CommandResult } from "@/lib/android-agent";

const WORKSPACE = process.env.OMNIAI_WORKSPACE?.trim() || process.cwd();

function bearer(req: Request): string | undefined {
  return req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
}

/** The companion posts a command's outcome here, unblocking the agent that dispatched it. */
export async function POST(req: Request) {
  const device = await authenticateDevice(WORKSPACE, bearer(req));
  if (!device) {
    return Response.json({ error: "Unauthorized device" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { commandId?: string; result?: CommandResult }
    | null;
  if (!body?.commandId || !body.result || typeof body.result.ok !== "boolean") {
    return Response.json({ error: "Expected { commandId, result: { ok, ... } }" }, { status: 400 });
  }

  const accepted = submitResult(device.id, body.commandId, body.result);
  return Response.json({ accepted });
}
