// Asks whether the turn actually worked.
//
// Until this existed the loop in app/api/chat/route.ts was purely reactive: the model called a
// tool, got a result, and carried on. `stopWhen: stepCountIs(20)` is a step budget, not a check —
// nothing anywhere asked whether an edit landed, whether a command did what it was supposed to,
// or whether a tap hit the right button. A failed action and a successful one reached the user
// looking identical, and the failure only surfaced when they noticed it themselves.
//
// The shape deliberately copies lib/agent-router.ts, for the same reason it was written that way:
// the default conversation model here is local and slow, so anything on the critical path has to
// earn its latency. Three tiers, cheapest first:
//
//   1. Free signals from the tool results themselves. Every tool in this app reports failure as
//      `{ error }`, which makes most real failures detectable for zero tokens and zero latency.
//   2. A model call, but only when tier 1 is clean AND the outcome isn't self-evident — i.e. the
//      actions ran without complaint but nothing proves they achieved what was asked.
//   3. A hard timeout that assumes success.
//
// Tier 3 is the important one. A critic that can block, hang, or fail a turn that actually worked
// is worse than no critic, so every uncertain path here resolves to "ok".

import { generateText, type LanguageModel } from "ai";
import { isMutatingTool } from "./tool-risk";

/** How long the model tier gets before we give up and assume the turn was fine. */
const CRITIC_TIMEOUT_MS = 20_000;

/**
 * Output budget for the verdict. Far larger than the one line it's asked for, because the models
 * this app defaults to are reasoning models: they emit thinking tokens first and the verdict last.
 * Measured against gpt-oss-agent, a budget of 64 was consumed entirely by reasoning and returned
 * `finishReason: "length"` with an empty text — which read as "didn't say FAIL", i.e. a silent
 * pass on a turn that had plainly failed. Verified working output is ~87 tokens; this leaves room.
 */
const CRITIC_MAX_TOKENS = 512;

/** Cap on how much of a tool result is shown to the critic model, per call. */
const MAX_RESULT_CHARS = 600;

/** Cap on the reason we surface, so a rambling model can't flood the UI. */
const MAX_REASON_CHARS = 300;

/**
 * One executed tool call, flattened out of the SDK's step results by the caller.
 *
 * Kept as a plain shape rather than the SDK's generic StepResult so this module stays independent
 * of streamText's type parameters and can be reasoned about (and tested) on its own.
 */
export type ToolOutcome = {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  /** The SDK marked the call itself as failed (threw, was denied, never returned). */
  errored?: boolean;
};

/**
 * `tier` records how the verdict was reached, and the passing ones are not equivalent:
 * "model" means the critic looked and approved, while "timeout" and "inconclusive" mean it never
 * produced an answer and the turn is being let through unverified. They're kept distinct so that
 * "we checked" is never silently conflated with "we couldn't check".
 */
export type CriticVerdict =
  | { ok: true; tier: "not-applicable" | "signals" | "model" | "timeout" | "inconclusive" }
  | { ok: false; tier: "signals" | "model"; reason: string };

/**
 * The parts of the SDK's StepResult this module needs, structurally typed so critic.ts doesn't
 * have to carry streamText's tool-set generics around.
 *
 * Entries are optional because each agent gets a `Partial` tool set (see toolsForAgent), which
 * leaves `undefined` in the SDK's inferred element types even though it never appears at runtime.
 */
type RawToolCall = { readonly toolName: string; readonly input?: unknown } | undefined;
type RawToolResult =
  | { readonly toolName: string; readonly input?: unknown; readonly output?: unknown }
  | undefined;

type RawStep = {
  readonly toolCalls?: readonly RawToolCall[];
  readonly toolResults?: readonly RawToolResult[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Flattens the turn's steps into the outcomes the critic judges.
 *
 * `complete` is false when some tool call never produced a result — which in this app means the
 * turn stopped to ask for approval, or the user denied it. Neither is a failure, and both leave
 * the work genuinely unfinished, so the caller skips verification rather than reporting that a
 * half-executed turn didn't achieve its goal.
 */
export function collectOutcomes(steps: readonly RawStep[]): {
  outcomes: ToolOutcome[];
  complete: boolean;
} {
  const outcomes: ToolOutcome[] = [];
  let calls = 0;

  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      if (call) calls += 1;
    }
    for (const result of step.toolResults ?? []) {
      if (!result) continue;
      outcomes.push({
        toolName: result.toolName,
        input: asRecord(result.input),
        output: result.output,
      });
    }
  }

  return { outcomes, complete: outcomes.length === calls };
}

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Pulls a tool's own `{ error }` report out of its output, if it made one. */
export function errorFrom(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const err = (output as { error?: unknown }).error;
  if (typeof err === "string" && err.trim()) return err.trim();
  return null;
}

/** Whether a tool result claims success loudly enough that no model check is needed. */
function selfEvidentlyDone(outcome: ToolOutcome): boolean {
  const { output } = outcome;
  if (!output || typeof output !== "object") return false;
  return (output as { success?: unknown }).success === true;
}

/**
 * Tier 1 — failures the tool results already prove, for free.
 *
 * Only unambiguous signals count. Scanning command output for the word "error" was considered and
 * left out: help text, linter summaries and progress logs contain it constantly, and a false
 * failure here costs a wasted retry on a model that takes real time to run.
 */
export function checkSignals(outcomes: readonly ToolOutcome[]): CriticVerdict | null {
  for (const outcome of outcomes) {
    if (outcome.errored) {
      return {
        ok: false,
        tier: "signals",
        reason: `${outcome.toolName} failed to execute.`,
      };
    }

    const error = errorFrom(outcome.output);
    if (error) {
      return {
        ok: false,
        tier: "signals",
        reason: clamp(`${outcome.toolName} reported: ${error}`, MAX_REASON_CHARS),
      };
    }

    // runCommand's persistent shell has no exit code to read — a command that hung is the one
    // failure it can state outright, and it does.
    const timedOut = (outcome.output as { timedOut?: unknown } | null)?.timedOut;
    if (timedOut === true) {
      return {
        ok: false,
        tier: "signals",
        reason: `${outcome.toolName} timed out before finishing.`,
      };
    }
  }

  return null;
}

function buildCriticPrompt(request: string, outcomes: readonly ToolOutcome[]): string {
  const actions = outcomes
    .map((o, i) => {
      const input = clamp(JSON.stringify(o.input ?? {}), MAX_RESULT_CHARS);
      const output = clamp(
        typeof o.output === "string" ? o.output : JSON.stringify(o.output ?? null),
        MAX_RESULT_CHARS
      );
      return `${i + 1}. ${o.toolName}\n   input: ${input}\n   result: ${output}`;
    })
    .join("\n");

  return `The user asked:
${clamp(request, 1000)}

These actions were taken on their machine:
${actions}

Did these actions accomplish what the user asked?`;
}

const CRITIC_SYSTEM = `You verify whether an assistant's actions achieved what the user asked. You are not the assistant and you do not help — you only judge what the results show.

Reply with exactly one line:
- "OK" if the actions plausibly accomplished the request.
- "FAIL: <one short sentence>" if the results show they did not.

Judge only what the results actually prove. Do not fail something for being incomplete in ways the user did not ask about, for style, or for a choice you would have made differently. When the results are consistent with success, answer OK. Uncertainty is OK, not FAIL.`;

/**
 * Tier 2 — one small model call, used only when the actions ran clean but nothing proves they
 * worked. Bounded output and a hard abort; any failure resolves to "ok" rather than blocking.
 */
async function checkWithModel(
  request: string,
  outcomes: readonly ToolOutcome[],
  model: LanguageModel
): Promise<CriticVerdict> {
  try {
    const { text, finishReason } = await generateText({
      model,
      system: CRITIC_SYSTEM,
      prompt: buildCriticPrompt(request, outcomes),
      maxOutputTokens: CRITIC_MAX_TOKENS,
      temperature: 0,
      abortSignal: AbortSignal.timeout(CRITIC_TIMEOUT_MS),
    });

    const answer = text.trim();

    // The critic didn't actually answer — it ran out of budget mid-thought, or returned nothing.
    // Absence of the word FAIL is not a pass here, it's a missing verdict, and treating it as
    // approval is how a critic ends up rubber-stamping every turn without anyone noticing.
    if (!answer || finishReason === "length") return { ok: true, tier: "inconclusive" };

    const failed = /^\s*fail\b/i.test(answer);
    if (!failed) return { ok: true, tier: "model" };

    const reason = answer.replace(/^\s*fail\s*:?\s*/i, "").trim();
    return {
      ok: false,
      tier: "model",
      // A FAIL with no stated reason is useless to retry on — treat the bare verdict as the reason
      // rather than sending the model back with nothing to act on.
      reason: clamp(reason || "The actions did not appear to accomplish the request.", MAX_REASON_CHARS),
    };
  } catch {
    // Timed out, model unavailable, provider error — none of these are evidence the turn failed.
    return { ok: true, tier: "timeout" };
  }
}

/**
 * Verifies a completed turn.
 *
 * Returns "ok" without spending anything when the turn changed nothing — a question answered from
 * knowledge, a file read, a search — which is the large majority of turns.
 */
export async function verifyTurn({
  request,
  outcomes,
  model,
}: {
  request: string;
  outcomes: readonly ToolOutcome[];
  model: LanguageModel;
}): Promise<CriticVerdict> {
  const mutations = outcomes.filter((o) => isMutatingTool(o.toolName, o.input));
  if (mutations.length === 0) return { ok: true, tier: "not-applicable" };

  // Tier 1: free, and catches most genuine failures.
  const signalled = checkSignals(mutations);
  if (signalled) return signalled;

  // Every action reported success outright — there is nothing left for a model to add.
  if (mutations.every(selfEvidentlyDone)) return { ok: true, tier: "signals" };

  // Tier 2 + 3.
  return checkWithModel(request, mutations, model);
}
