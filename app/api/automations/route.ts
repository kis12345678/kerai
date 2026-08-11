import { listAutomations, createAutomation, deleteAutomation } from "@/lib/automation-store";
import { ensureSchedulerRunning } from "@/lib/automation-scheduler";

export async function GET() {
  ensureSchedulerRunning();
  const automations = await listAutomations();
  return Response.json({ automations });
}

export async function POST(req: Request) {
  ensureSchedulerRunning();
  const body = await req.json();
  const { label, prompt, workspaceRoot, model, schedule } = body;

  if (!label?.trim() || !prompt?.trim() || !workspaceRoot?.trim()) {
    return Response.json({ error: "label, prompt, and workspaceRoot are required" }, { status: 400 });
  }
  if (schedule?.type !== "daily" && schedule?.type !== "interval") {
    return Response.json({ error: "schedule.type must be \"daily\" or \"interval\"" }, { status: 400 });
  }

  const automation = await createAutomation({
    label: label.trim(),
    prompt: prompt.trim(),
    workspaceRoot: workspaceRoot.trim(),
    model: model?.trim() || "",
    schedule,
  });
  return Response.json({ automation });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deleteAutomation(id);
  return Response.json({ success: true });
}
