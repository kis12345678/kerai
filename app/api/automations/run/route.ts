import { runAutomationNow } from "@/lib/automation-scheduler";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const result = await runAutomationNow(id);
  if (!result.ok) {
    return Response.json({ error: result.error, alreadyRunning: result.alreadyRunning }, { status: 409 });
  }
  return Response.json({ ok: true, result: result.result });
}
