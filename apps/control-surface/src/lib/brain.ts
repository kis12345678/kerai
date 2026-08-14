/**
 * KERAI Human-Like Brain — Conversation Classifier
 *
 * Determines whether user input is casual conversation (answered locally and
 * instantly) or a real action/task (routed to the agent mission pipeline).
 *
 * This keeps KERAI feeling like a gentleman — it doesn't spin up a whole
 * agent mission just because you said "hi" or "thanks".
 */

export type InputKind = 'chat' | 'action';

interface ClassifyResult {
  kind: InputKind;
  reply?: string; // pre-built reply for obvious chat inputs
}

/* ------------------------------------------------------------------ */
/* Conversation patterns (casual → answer locally, no mission)         */
/* ------------------------------------------------------------------ */

const GREETINGS = [
  /^(hi|hello|hey|sup|yo|hiya|howdy|what'?s up|whats up|good (morning|afternoon|evening|night))[!.,?]?$/i,
  /^(namaste|salaam|bonjour|hola|ciao|kem cho|kem chho|kem cho[\s!]*|kyo cho|kem)\b/i,
];

const FAREWELLS = [
  /^(bye|goodbye|see ya|later|cya|take care|good night|goodnight|night)[!.,?]?$/i,
];

const THANKS = [
  /^(thank(s| you)|thx|ty|cheers|much appreciated|great|awesome|nice|perfect|cool|got it|ok(ay)?|roger|understood)[!.,?]?$/i,
];

const SELF_QUESTIONS = [
  /^(who are you|what are you|what'?s your name|your name|introduce yourself|tell me about yourself)/i,
  /^(what can you do|what do you do|what are your (abilities|capabilities|skills)|your abilities)/i,
  /^(are you (a|an) (ai|robot|bot|assistant|human))[?!.]?$/i,
  /^(how (smart|intelligent|powerful) are you)/i,
];

const SMALL_TALK = [
  /^(how are you|how'?s it going|how do you do|you ok|you good|you alright)[?!.,]?$/i,
  /^(what'?s new|anything new|what'?s happening)[?!.]?$/i,
  /^(haha|lol|lmao|hehe|😄|😂|🤣)[!.]*$/i,
  /^(nice|great|awesome|perfect|wow|amazing|cool|excellent|brilliant|fantastic|wonderful)[!.,]?$/i,
];

const GENERAL_KNOWLEDGE = [
  /^what (is|are) (a |an |the )?\w+[\s\w]*\??$/i, // "what is X?"
  /^(tell me|explain|describe|define|what does) .{3,80}\??$/i,
  /^(who (is|was|are|were)) .{2,60}\??$/i,
  /^(when (is|was|did|does)) .{2,80}\??$/i,
  /^(why (is|are|do|does|did)) .{2,80}\??$/i,
  /^(how (do|does|did|can|to)) .{2,80}\??$/i,
];

/* ------------------------------------------------------------------ */
/* Action patterns (route to mission pipeline)                         */
/* ------------------------------------------------------------------ */

const ACTION_KEYWORDS = [
  // File / code / workspace
  'open file', 'read file', 'write', 'create file', 'delete file', 'edit', 'fix', 'build',
  'run', 'test', 'deploy', 'debug', 'compile', 'install', 'code', 'implement', 'refactor',
  'analyze project', 'check project', 'inspect workspace',
  // Computer control
  'open ', 'launch ', 'close ', 'kill ', 'start ', 'stop process',
  'screenshot', 'take a screenshot', 'screen capture',
  'copy to clipboard', 'paste', 'clipboard',
  'minimize', 'maximize', 'focus window',
  // Web / search
  'search for', 'look up', 'find online', 'google', 'web search',
  'fetch page', 'open url', 'browse',
  // Mission-flavored
  'mission', 'task', 'automate', 'schedule',
  'git status', 'git diff', 'commit',
];

/* ------------------------------------------------------------------ */
/* Instant reply bank for common chat patterns                         */
/* ------------------------------------------------------------------ */

const GREETING_REPLIES = [
  "Hey there! What can I do for you today?",
  "Hello! Ready when you are.",
  "Hi! What's on your mind?",
  "Hey! I'm here. What do you need?",
];

const FAREWELL_REPLIES = [
  "See you! I'll be here when you need me.",
  "Take care! I'll keep an eye on things.",
  "Goodbye! Don't hesitate to come back.",
];

const THANKS_REPLIES = [
  "Happy to help!",
  "Of course! Anything else?",
  "Anytime!",
  "Always here for you.",
  "No problem at all!",
];

const HOW_ARE_YOU_REPLIES = [
  "All systems running perfectly — ready to help you with anything!",
  "Doing great! What can I take care of for you?",
  "Sharp as ever. What do you need?",
];

const WHO_ARE_YOU_REPLIES = [
  "I'm KERAI — your fully autonomous AI assistant running right here on your machine. Think of me as your personal JARVIS. I can write code, control your computer, search the web, take screenshots, and much more. What would you like me to do?",
  "KERAI at your service — an intelligent, local AI agent. I can handle coding tasks, control your PC, search the internet in real time, and hold a natural conversation. What's the mission?",
];

const ABILITY_REPLIES = [
  "I can do a lot! Here's the short version:\n\n• 💻 **Code & Debug** — read, write, build, and test code in your workspace\n• 🖥️ **Computer Control** — open apps, manage windows, control the clipboard\n• 🌐 **Web Research** — search the internet and read pages in real time\n• 📸 **Screen Vision** — take screenshots and visually inspect your desktop\n• 🔊 **Voice** — speak and listen in multiple languages\n• 🤖 **Autonomous Missions** — run multi-step tasks completely hands-free\n\nJust tell me what you need.",
];

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ------------------------------------------------------------------ */
/* Main classifier                                                      */
/* ------------------------------------------------------------------ */

export function classifyInput(raw: string): ClassifyResult {
  const input = raw.trim();
  if (!input) return { kind: 'chat', reply: "I didn't catch that — what would you like me to do?" };

  const lower = input.toLowerCase().trim();

  // --- Hard action keywords take priority (explicit tasks/tools/operations) ---
  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw)) return { kind: 'action' };
  }

  // --- Explicit action verbs at start of prompt ---
  if (/^(create|delete|remove|install|build|fix|edit|run|deploy|compile|refactor|screenshot|launch|focus|minimize|maximize)\s+/i.test(lower)) {
    return { kind: 'action' };
  }

  // --- Short inputs are almost always conversational ---
  if (input.length <= 3) return { kind: 'chat', reply: "I'm here — go ahead!" };

  // --- Greetings ---
  if (GREETINGS.some(r => r.test(lower))) return { kind: 'chat', reply: pick(GREETING_REPLIES) };

  // --- Farewells ---
  if (FAREWELLS.some(r => r.test(lower))) return { kind: 'chat', reply: pick(FAREWELL_REPLIES) };

  // --- Thanks / affirmations ---
  if (THANKS.some(r => r.test(lower))) return { kind: 'chat', reply: pick(THANKS_REPLIES) };

  // --- Small talk / how are you ---
  if (/^how are you/i.test(lower)) return { kind: 'chat', reply: pick(HOW_ARE_YOU_REPLIES) };
  if (SMALL_TALK.some(r => r.test(lower))) return { kind: 'chat', reply: pick(GREETING_REPLIES) };

  // --- Self-identity questions ---
  if (SELF_QUESTIONS.some(r => r.test(lower))) {
    if (/abilit|capabilit|what can|what do you do/i.test(lower))
      return { kind: 'chat', reply: pick(ABILITY_REPLIES) };
    return { kind: 'chat', reply: pick(WHO_ARE_YOU_REPLIES) };
  }

  // --- General questions, math, explanations, creative requests, conversation -> CHAT ---
  if (/^(what|why|how|who|when|where|can you|could you|explain|tell me|describe|define|is |are |does |do |is it|would|calculate|write|recommend|joke)\b/i.test(lower)) {
    return { kind: 'chat' };
  }

  // --- Default: treat general conversation as CHAT (do not spin up a mission) ---
  return { kind: 'chat' };
}
