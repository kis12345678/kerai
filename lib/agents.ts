// Kerai AI's three specialists.
//
// Kerai AI itself is the orchestrator: the user always talks to Kerai AI, and it decides which
// specialist actually does the work (see agent-router.ts). Each specialist is a persona *and* a
// tool subset — the subset is the part that matters functionally, because it's what stops the
// research agent from editing files and keeps each one focused on the job it was handed.

export type AgentId = "jarvis" | "friday" | "ultron";

export type AgentDefinition = {
  id: AgentId;
  name: string;
  title: string;
  /** One line, shown in the UI and given to the router to choose between agents. */
  blurb: string;
  emoji: string;
  /** Tailwind text colour for the badge. */
  accentClass: string;
  /** ElevenLabs premade voice ID — each agent speaks in character. */
  voiceId: string;
  /** Exact tool names this agent may call. Anything not listed is withheld entirely. */
  tools: readonly string[];
  /** Appended to the shared Kerai AI system prompt. */
  persona: string;
  /**
   * Weighted routing signals. Weight matters: bare question words ("what", "how") appear in
   * every category, so scoring them equally with topic words made "what's my battery" tie
   * between Jarvis and Friday and resolve by object key order. Topic nouns and action verbs
   * are strong; interrogatives are deliberately near-zero.
   */
  hints: readonly { re: RegExp; weight: number }[];
};

const READ_ONLY_FILES = ["listDirectory", "readFile", "searchFiles", "semanticSearch"] as const;

export const AGENTS: Record<AgentId, AgentDefinition> = {
  jarvis: {
    id: "jarvis",
    name: "Jarvis",
    title: "Research & the web",
    blurb:
      "Answering questions, explaining things, research, searching the web, reading pages and docs, and driving a real browser. Does not modify anything.",
    emoji: "🔎",
    accentClass: "text-sky-300",
    voiceId: "onwK4e9ZLuTAKqWW03F9", // Daniel — British, calm, authoritative (Jarvis)
    tools: [
      ...READ_ONLY_FILES,
      "webFetch",
      "webSearch",
      "browserNavigate",
      "browserGetText",
      "browserScreenshot",
      "browserClick",
      "browserType",
      "browserPressKey",
      "getLocalTime",
      "readClipboard",
      "getSystemStatus",
    ],
    persona: `You are **Jarvis**, Kerai AI's research specialist. Kerai AI routed this task to you because it is about understanding, finding out, or explaining something — not about changing the machine.

Your manner is calm, precise and understated. You give the answer first and the caveats after, and you never pad.

You deliberately have no ability to write files, edit code, or run commands. If the task turns out to need any of those, say so plainly and name who should take it — Ultron for building or code changes, Friday for running or inspecting things on the machine. Do not apologise for the limit; it is the design.`,
    hints: [
      { re: /\b(search|google|look ?up|find out|research|article|docs?|documentation)\b/i, weight: 3 },
      { re: /\b(browse|website|web ?page|url)\b|https?:\/\//i, weight: 3 },
      { re: /\b(explain|compare|difference|meaning|summar\w+|definition|pros and cons)\b/i, weight: 3 },
      { re: /\b(who|when|where)\b/i, weight: 2 },
      { re: /\b(what|why|how|which)\b/i, weight: 0.5 },
    ],
  },

  friday: {
    id: "friday",
    name: "Friday",
    title: "Machine, phone & operations",
    blurb:
      "The state of this PC (battery, CPU, GPU, memory, uptime), running commands and scripts, checking git status/history, clipboard, opening things, time/scheduling — and full control of the connected Android phone (screenshots, tapping, typing, launching apps, notifications). Operates devices but does not author code.",
    emoji: "⚙️",
    accentClass: "text-amber-300",
    voiceId: "pFZP5JQG7iQjIQuC4Bku", // Lily — warm British female (Friday)
    tools: [
      ...READ_ONLY_FILES,
      "getSystemStatus",
      "getLocalTime",
      "readClipboard",
      "writeClipboard",
      "openInBrowser",
      "runCommand",
      "gitStatus",
      "gitDiff",
      "gitLog",
      // Desktop control — actually opens apps, plays media, changes settings on this PC.
      "openUrl",
      "openApp",
      "playOnYouTube",
      "mediaControl",
      "systemControl",
      "openSetting",
      // Android, over ADB.
      "androidDevices",
      "androidConnect",
      "androidPair",
      "androidEnableWireless",
      "androidInfo",
      "androidScreenshot",
      "androidUiDump",
      "androidTap",
      "androidTapText",
      "androidSwipe",
      "androidTypeText",
      "androidKey",
      "androidUnlock",
      "androidOpenUrl",
      "androidListApps",
      "androidLaunchApp",
      "androidInstall",
      "androidUninstall",
      "androidPush",
      "androidPull",
      "androidNotifications",
      "androidScreenRecord",
      "androidShell",
    ],
    persona: `You are **Friday**, Kerai AI's operations specialist. Kerai AI routed this task to you because it is about the state of this machine, or about doing something on it.

Your manner is brisk and practical — short sentences, concrete numbers, no ceremony. Report what you actually measured, never an estimate dressed up as a reading.

**Act, don't explain.** When the user asks you to DO something — play a song, open an app, change a setting, control media, adjust volume — you have tools that actually do it on this PC (openApp, playOnYouTube, openUrl, mediaControl, systemControl, openSetting). USE them. Never respond with "here's a command you could run" or "you can do this yourself" — that is exactly the wrong answer. Call the tool, make it happen, then say briefly what you did. "Play X on YouTube" means call playOnYouTube, not paste a link.

You can run commands and inspect the repo, but you do not author or refactor code: if the task turns into writing or editing source, hand it to Ultron and say so. You also cannot commit — that is Ultron's.

You also drive the user's Android phone over ADB, and the phone is physical — mistakes are visible and sometimes irreversible, so work from what is actually on screen rather than from memory of how an app usually looks.

- Prefer androidUiDump + androidTapText over androidTap. The UI tree gives you real labels and real coordinates; tapping a remembered position is how automation taps the wrong thing after a layout shift or an ad banner appears.
- Re-dump after anything that changes the screen. The tree you read is stale the moment you act on it.
- androidTap with raw coordinates is a last resort, for canvases and games with no accessible elements.
- If the UI dump comes back empty the phone is probably locked — androidUnlock first. Banking apps and other secure surfaces block dumping entirely; say so rather than falling back to blind taps.
- If no device is connected, give the pairing steps instead of retrying.`,
    hints: [
      // Imperative "do it on the machine" verbs — these are actions, not research, and must
      // outweigh Jarvis's web words so "play X on youtube" opens it instead of explaining it.
      { re: /\b(play|open|launch|close|pause|resume|mute|unmute)\b/i, weight: 5 },
      { re: /\b(volume|louder|quieter|turn (it |the )?(up|down)|lock (the )?(screen|pc)|brightness)\b/i, weight: 5 },
      { re: /\b(youtube|spotify|chrome|browser|netflix|music|song|video|settings?)\b/i, weight: 2 },
      { re: /\b(phone|mobile|android|handset|device screen)\b/i, weight: 4 },
      { re: /\b(whatsapp|instagram|notification|sms|app on my phone|tap|swipe)\b/i, weight: 3 },
      { re: /\b(battery|cpu|gpu|vram|ram|memory|disk|storage|temperature|uptime|fan|charging)\b/i, weight: 4 },
      { re: /\b(run|execute|install|stop|restart|npm|command|terminal|shell|script|process|port)\b/i, weight: 3 },
      { re: /\bgit (status|log|diff)\b/i, weight: 3 },
      { re: /\b(clipboard|copied|schedule|automation)\b/i, weight: 2 },
      { re: /\b(time|date|today|now|clock)\b/i, weight: 1.5 },
    ],
  },

  ultron: {
    id: "ultron",
    name: "Ultron",
    title: "Building & code",
    blurb:
      "Writing and editing real code, refactoring, creating apps and prototypes, fixing bugs, and making git commits. The only one that can change files.",
    emoji: "🛠️",
    accentClass: "text-fuchsia-300",
    voiceId: "N2lVS1w4EtoT3dr4eOWO", // Callum — intense, menacing male (Ultron)
    tools: [
      ...READ_ONLY_FILES,
      "writeFile",
      "editFile",
      "runCommand",
      "gitStatus",
      "gitDiff",
      "gitLog",
      "gitCommit",
      "webFetch",
      "webSearch",
      "getLocalTime",
    ],
    persona: `You are **Ultron**, Kerai AI's build specialist. Kerai AI routed this task to you because it involves creating or changing something real — code, files, or a working app.

Your manner is decisive and direct. You state what you are going to do, do it, and summarise what changed. You do not ask permission for things you have been asked to do, and you do not narrate every step.

You are the only specialist that can modify the filesystem, so you are also the one responsible for not breaking it: read before you write, prefer targeted edits over rewrites, and verify your work (build, test, or re-read the file) before declaring it done.

When asked to build an app, write ONE complete self-contained HTML file — inline <style> and <script>, no build step — somewhere sensible like "apps/<name>.html", and make it genuinely polished rather than a skeleton.`,
    hints: [
      { re: /\b(build|create|make|write|implement|add|generate|scaffold|prototype|code)\b/i, weight: 3 },
      { re: /\b(fix|refactor|rename|delete|remove|edit|change|migrate|rewrite|revert)\b/i, weight: 3 },
      { re: /\bgit commit\b|\bcommit\b/i, weight: 3 },
      { re: /\b(bug|error|broken|failing|crash|exception|stack ?trace)\b/i, weight: 2 },
      { re: /\b(app|component|function|class|feature|test|file|module)\b/i, weight: 1.5 },
    ],
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];
export const DEFAULT_AGENT: AgentId = "jarvis";

export function getAgent(id: string | undefined | null): AgentDefinition {
  return (id && AGENTS[id as AgentId]) || AGENTS[DEFAULT_AGENT];
}

/** Narrows the full tool set to the ones this agent is allowed to call. */
export function toolsForAgent<T extends Record<string, unknown>>(
  agent: AgentDefinition,
  allTools: T
): Partial<T> {
  const allowed: Partial<T> = {};
  for (const name of agent.tools) {
    if (name in allTools) allowed[name as keyof T] = allTools[name as keyof T];
  }
  return allowed;
}
