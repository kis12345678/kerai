import {
  listAutomations,
  createAutomation,
  updateAutomation,
  setAutomationEnabled,
  deleteAutomation,
  type AutomationInput,
} from "@/lib/automation-store";
import { ensureSchedulerRunning } from "@/lib/automation-scheduler";

function isValidSchedule(schedule: unknown): schedule is AutomationInput["schedule"] {
  if (typeof schedule !== "object" || schedule === null) return false;
  const s = schedule as { type?: unknown };
  if (s.type === "daily") {
    const hhmm = (s as { hhmm?: unknown }).hhmm;
    return typeof hhmm === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
  }
  if (s.type === "interval") {
    const everyMinutes = (s as { everyMinutes?: unknown }).everyMinutes;
    return typeof everyMinutes === "number" && everyMinutes >= 5;
  }
  return false;
}

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
  if (!isValidSchedule(schedule)) {
    return Response.json({ error: "schedule must be \"daily\" with hhmm or \"interval\" with everyMinutes >= 5" }, { status: 400 });
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

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Toggling pause/resume is a distinct, validated shape.
  if (typeof fields.enabled === "boolean") {
    const automation = await setAutomationEnabled(id, fields.enabled);
    if (!automation) return Response.json({ error: "Automation not found" }, { status: 404 });
    return Response.json({ automation });
  }

  const patch: Partial<AutomationInput> = {};
  if (fields.label !== undefined) {
    if (!fields.label?.trim()) return Response.json({ error: "label cannot be empty" }, { status: 400 });
    patch.label = fields.label.trim();
  }
  if (fields.prompt !== undefined) {
    if (!fields.prompt?.trim()) return Response.json({ error: "prompt cannot be empty" }, { status: 400 });
    patch.prompt = fields.prompt.trim();
  }
  if (fields.workspaceRoot !== undefined) {
    if (!fields.workspaceRoot?.trim()) return Response.json({ error: "workspaceRoot cannot be empty" }, { status: 400 });
    patch.workspaceRoot = fields.workspaceRoot.trim();
  }
  if (fields.model !== undefined) patch.model = fields.model.trim() || "";
  if (fields.schedule !== undefined) {
    if (!isValidSchedule(fields.schedule)) {
      return Response.json({ error: "schedule must be \"daily\" with hhmm or \"interval\" with everyMinutes >= 5" }, { status: 400 });
    }
    patch.schedule = fields.schedule;
  }

  const automation = await updateAutomation(id, patch);
  if (!automation) return Response.json({ error: "Automation not found" }, { status: 404 });
  return Response.json({ automation });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  await deleteAutomation(id);
  return Response.json({ success: true });
}
