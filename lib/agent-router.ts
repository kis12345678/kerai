// Decides which specialist Kerai AI hands a task to.
//
// Tiers, cheapest first:
//   1. Explicit address ("Ultron, fix this") — free, and always wins: an instruction from the
//      user should never be second-guessed by a classifier.
//   2. Weighted keyword scoring — free, and decides the large majority of real requests.
//   3. A model call, but ONLY when scoring is ambiguous, and under a hard timeout.
//
// Tier 3 is last on purpose. The default conversation model here is a local reasoning model
// that can take over a minute to produce even a handful of tokens, so routing every turn
// through it added more latency than the actual answer. It now runs rarely and can never hang
// the request: on timeout or error the best heuristic guess is used instead.

import { generateText, type LanguageModel, type UIMessage } from "ai";
import { AGENTS, AGENT_IDS, DEFAULT_AGENT, type AgentId } from "./agents";

export type RoutingDecision = {
  agent: AgentId;
  reason: "explicit" | "model" | "heuristic" | "fallback";
};

/** How long the escalation model gets before we give up and use the heuristic guess. */
const ROUTER_TIMEOUT_MS = 8000;

/** Score needed to trust scoring outright, and the lead required over the runner-up. */
const CONFIDENT_SCORE = 2;
const CONFIDENT_MARGIN = 1;

function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((p): p is typeof p & { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/** The most recent thing the user actually said — what routing, and later verification, judge. */
export function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return textOf(messages[i]);
  }
  return "";
}

/**
 * "Ultron, build me X" / "hey friday what's my battery" / "ask jarvis to look this up".
 * Only matches near the start, so merely mentioning an agent mid-sentence ("Ultron wrote this
 * earlier") doesn't hijack routing.
 */
export function explicitAgent(text: string): AgentId | null {
  const head = text.trimStart().slice(0, 60).toLowerCase();
  for (const id of AGENT_IDS) {
    // "ask jarvis to …" / "tell ultron to …" — naturally unambiguous, no separator needed.
    if (new RegExp(`^(ask|tell) ${id}\\b`).test(head)) return id;
    // "hey friday what's my battery" — a greeting prefix is addressing by itself; the name
    // being spoken to *is* the address, so no separator is required after it.
    if (new RegExp(`^(hey |ok |okay |yo )${id}\\b`).test(head)) return id;
    // "ultron, …" / "friday: …" — a bare name only counts as an address when a separator
    // follows. That's what distinguishes it from a mere reference: without the separator,
    // "ultron wrote this earlier" would read as addressing Ultron.
    if (new RegExp(`^${id}\\b\\s*[,:;.!?—-]`).test(head)) return id;
  }
  return null;
}

export type Scores = Record<AgentId, number>;

export function scoreAgents(text: string): Scores {
  const scores = {} as Scores;
  for (const id of AGENT_IDS) {
    scores[id] = AGENTS[id].hints.reduce((n, h) => n + (h.re.test(text) ? h.weight : 0), 0);
  }
  return scores;
}

/** Returns the winner only when scoring is decisive; null means "ask the model". */
export function confidentAgent(text: string): AgentId | null {
  const scores = scoreAgents(text);
  const ranked = AGENT_IDS.map((id) => ({ id, score: scores[id] })).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first || first.score < CONFIDENT_SCORE) return null;
  if (second && first.score - second.score < CONFIDENT_MARGIN) return null;
  return first.id;
}

/** Best guess regardless of confidence — used when the model tier is unavailable. */
export function bestGuessAgent(text: string): AgentId | null {
  const scores = scoreAgents(text);
  const ranked = AGENT_IDS.map((id) => ({ id, score: scores[id] })).sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].id : null;
}

function buildRoutingPrompt(): string {
  const roster = AGENT_IDS.map((id) => `- ${id}: ${AGENTS[id].blurb}`).join("\n");
  return `You are the dispatcher inside Kerai AI. Assign the user's request to exactly one specialist.

${roster}

Rules:
- Answer with the specialist's id and nothing else: ${AGENT_IDS.join(", ")}.
- Choose by what the task actually requires, not by its wording.
- If it requires changing any file or writing code, choose ultron.
- If it only requires reading, searching, or explaining, choose jarvis.
- If it is about this machine's state or running an existing command, choose friday.`;
}

export async function routeTask({
  messages,
  model,
}: {
  messages: UIMessage[];
  model: LanguageModel;
}): Promise<RoutingDecision> {
  const text = lastUserText(messages);
  if (!text) return { agent: DEFAULT_AGENT, reason: "fallback" };

  const explicit = explicitAgent(text);
  if (explicit) return { agent: explicit, reason: "explicit" };

  const confident = confidentAgent(text);
  if (confident) return { agent: confident, reason: "heuristic" };

  try {
    const { text: raw } = await generateText({
      model,
      system: buildRoutingPrompt(),
      // Only the latest request is classified. Feeding the whole history made the router
      // sticky — it kept re-picking whoever handled the previous turn.
      prompt: text.slice(0, 2000),
      maxOutputTokens: 16,
      temperature: 0,
      abortSignal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    const picked = AGENT_IDS.find((id) => raw.toLowerCase().includes(id));
    if (picked) return { agent: picked, reason: "model" };
  } catch {
    // Timed out or errored — fall through rather than failing the user's request.
  }

  const guessed = bestGuessAgent(text);
  if (guessed) return { agent: guessed, reason: "heuristic" };
  return { agent: DEFAULT_AGENT, reason: "fallback" };
}
