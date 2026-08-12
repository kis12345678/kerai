// Single source of truth for which tools may act without asking first.
//
// This used to be an object literal inline in app/api/chat/route.ts — a hand-maintained list of
// tool names living in a different file from the tools themselves. Nothing tied the two together,
// so a tool could be added, wired into an agent's roster, and shipped without anyone noticing it
// never got an approval entry. That is exactly what happened to the desktop-control tools: they
// reached the real machine with no gate at all while their local-tools equivalents were gated.
//
// Two changes make that class of bug structural rather than a matter of remembering:
//
//   1. Everything is classified here, next to the reasoning, and the approval map is derived.
//   2. Anything NOT classified here defaults to requiring approval (see buildToolApproval).
//      A new tool is therefore gated from the moment it exists, and staying ungated is the
//      thing you have to do deliberately.
//
// The bar for "safe" is deliberately narrow: it reads state, or its entire effect is something
// on screen the user can undo by looking at it and clicking once. Anything that writes a file,
// runs a process, touches the phone, or acts on the user's behalf inside a logged-in browser
// session is gated, however convenient that would have been.

/** What a policy decides for one call. `deny` refuses outright, with a reason shown to the model. */
export type RiskVerdict = "safe" | "approve" | { deny: string };

/**
 * Either a fixed classification, or a function that decides from the call's arguments.
 * Argument-aware policies exist so a tool with one dangerous mode doesn't have to be gated
 * entirely — see openApp and systemControl below.
 */
export type RiskPolicy = "safe" | "approve" | ((input: Record<string, unknown>) => RiskVerdict);

/**
 * GUI applications openApp may launch without asking.
 *
 * openApp runs `Start-Process <name>`, which resolves anything on PATH — so an unrestricted
 * openApp is a second, ungated runCommand, despite runCommand itself being gated. Rather than
 * gate openApp entirely (which would break the point of it: a spoken "open spotify" happening
 * immediately), the common GUI targets are allowlisted and everything else asks.
 *
 * Deliberately excluded, even though they're "just apps": cmd, powershell, pwsh, wt, wsl,
 * regedit, taskmgr, msconfig, mmc, and anything else whose purpose is running further commands.
 */
const OPENABLE_APPS = new Set([
  "chrome", "firefox", "edge", "msedge", "brave", "opera",
  "spotify", "youtube", "netflix", "vlc", "music",
  "notepad", "calc", "calculator", "explorer", "settings",
  "word", "excel", "powerpoint", "outlook", "onenote",
  "maps", "google", "photos", "camera", "mail", "teams", "slack", "discord",
  "code", "vscode",
]);

/**
 * Every tool in the app, and whether it may act unprompted.
 *
 * Grouped by module so a new tool's home is obvious. Keep this list in the same order as the
 * create*Tools() return objects it mirrors — it makes an omission visible on sight.
 */
export const TOOL_RISK: Record<string, RiskPolicy> = {
  // --- agent-tools: workspace filesystem ---------------------------------------------------
  listDirectory: "safe",
  readFile: "safe",
  searchFiles: "safe",
  writeFile: "approve",
  editFile: "approve",
  runCommand: "approve",

  // --- semantic-search ----------------------------------------------------------------------
  // Builds an embeddings index under .omniai/ on first use. That's a cache in a directory this
  // app owns, not user content, so it doesn't warrant a prompt.
  semanticSearch: "safe",

  // --- git-tools ----------------------------------------------------------------------------
  gitStatus: "safe",
  gitDiff: "safe",
  gitLog: "safe",
  gitCommit: "approve",

  // --- web-tools / web-search ---------------------------------------------------------------
  webFetch: "safe",
  webSearch: "safe",

  // --- browser-tools: the headless Chromium instance ----------------------------------------
  // Reading is safe because nothing is visible to the user and no session of theirs is involved.
  // Interaction is gated: a click in a logged-in session acts as the user.
  browserNavigate: "safe",
  browserGetText: "safe",
  browserScreenshot: "safe",
  browserClick: "approve",
  browserType: "approve",
  browserPressKey: "approve",

  // --- system-tools -------------------------------------------------------------------------
  getSystemStatus: "safe",

  // --- local-tools --------------------------------------------------------------------------
  getLocalTime: "safe",
  readClipboard: "safe",
  writeClipboard: "approve", // destroys whatever the user had copied
  openInBrowser: "approve",

  // --- desktop-control: acts on this physical PC --------------------------------------------
  // The module header calls these low-risk and ships them ungated. That holds for the media keys
  // and for opening a Settings panel; it does not hold for the three below it.

  // Gated to match openInBrowser, which does the same thing — open a URL in the user's real,
  // logged-in browser — and has always required approval. Two tools with one capability and
  // opposite postures meant the gate could simply be routed around.
  openUrl: "approve",

  // Constrained to a YouTube search URL it builds itself, so the model cannot choose the
  // destination. This is the "play a song by voice" path and is meant to be instant.
  playOnYouTube: "safe",

  mediaControl: "safe", // play/pause/next/prev — reversible by pressing it again

  openApp: (input) => {
    const app = typeof input.app === "string" ? input.app.trim().toLowerCase() : "";
    if (OPENABLE_APPS.has(app)) return "safe";
    return "approve";
  },

  systemControl: (input) => {
    // Locking the workstation interrupts whatever the user is doing and costs them a password to
    // undo. Volume and mute are trivially reversible and stay instant.
    if (input.action === "lock") return "approve";
    return "safe";
  },

  openSetting: "safe", // enum-constrained ms-settings: panel; opens a window, changes nothing

  // --- android-tools: acts on the physical phone --------------------------------------------
  // Reads stay unprompted so the agent can look before it acts — that's what makes
  // androidUiDump-then-androidTapText possible instead of tapping blind.
  androidDevices: "safe",
  androidInfo: "safe",
  androidScreenshot: "safe",
  androidUiDump: "safe",
  androidListApps: "safe",
  androidNotifications: "safe",

  androidConnect: "approve",
  androidPair: "approve",
  androidEnableWireless: "approve",
  androidTap: "approve",
  androidTapText: "approve",
  androidSwipe: "approve",
  androidTypeText: "approve",
  androidKey: "approve",
  androidUnlock: "approve",
  androidOpenUrl: "approve",
  androidLaunchApp: "approve",
  androidInstall: "approve",
  androidUninstall: "approve",
  androidPush: "approve",
  androidScreenRecord: "approve",
  androidShell: "approve",

  // Writes a file from the phone into the workspace, and can overwrite one that's already there.
  // It's constrained to the workspace, but so is writeFile, and writeFile asks.
  androidPull: "approve",
};

/**
 * Whether a call actually changed something outside the app.
 *
 * Same classification as the approval gate, reused deliberately: "needed permission to run" and
 * "is worth verifying afterwards" are the same question asked at two different times, and letting
 * them drift apart is how you end up verifying reads while silently trusting writes. Unclassified
 * tools count as mutating, matching the fail-closed default in buildToolApproval.
 */
export function isMutatingTool(toolName: string, input: Record<string, unknown> = {}): boolean {
  const policy = TOOL_RISK[toolName];
  if (policy === undefined) return true;
  if (policy === "safe") return false;
  if (policy === "approve") return true;
  return policy(input) !== "safe";
}

/** Tool names with no entry in TOOL_RISK — these fall back to requiring approval. */
export function unclassifiedTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => !(name in TOOL_RISK));
}

type ApprovalStatus = "not-applicable" | "user-approval" | { type: "denied"; reason: string };

function verdictToStatus(verdict: RiskVerdict): ApprovalStatus {
  if (verdict === "safe") return "not-applicable";
  if (verdict === "approve") return "user-approval";
  return { type: "denied", reason: verdict.deny };
}

/**
 * Builds the `toolApproval` map streamText expects, covering exactly the tools passed in.
 *
 * Fail-closed: a tool with no entry in TOOL_RISK gets "user-approval". The user sees a prompt for
 * something that should probably have been silent, which is a papercut; the alternative is a tool
 * reaching the machine unannounced, which is not.
 */
export function buildToolApproval(
  toolNames: readonly string[]
): Record<string, ApprovalStatus | ((input: Record<string, unknown>) => ApprovalStatus)> {
  const map: Record<string, ApprovalStatus | ((input: Record<string, unknown>) => ApprovalStatus)> =
    {};

  for (const name of toolNames) {
    const policy = TOOL_RISK[name];

    if (policy === undefined) {
      map[name] = "user-approval";
      continue;
    }
    if (typeof policy === "function") {
      map[name] = (input: Record<string, unknown>) => verdictToStatus(policy(input));
      continue;
    }
    map[name] = verdictToStatus(policy);
  }

  return map;
}
