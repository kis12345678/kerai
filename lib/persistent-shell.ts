import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type ShellSession = {
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  // Serializes commands run against this session so concurrent runCommand calls (the AI SDK
  // can execute a step's tool calls concurrently) don't race on the shared buffer/stdin.
  queue: Promise<void>;
};

declare global {
  var __omniaiShellSessions: Map<string, ShellSession> | undefined;
}

// Keyed via globalThis so sessions survive Next.js dev-mode module reloads, the same way
// TOOL_APPROVAL_SECRET does — otherwise every hot reload would silently drop live shells.
const sessions: Map<string, ShellSession> =
  globalThis.__omniaiShellSessions ?? (globalThis.__omniaiShellSessions = new Map());

function spawnShell(cwd: string): ChildProcessWithoutNullStreams {
  return process.platform === "win32"
    ? spawn("cmd.exe", [], { cwd, windowsHide: true })
    : spawn("/bin/sh", [], { cwd });
}

function getSession(workspaceRoot: string): ShellSession {
  const existing = sessions.get(workspaceRoot);
  if (existing && existing.proc.exitCode === null && !existing.proc.killed) return existing;

  const proc = spawnShell(workspaceRoot);
  const session: ShellSession = { proc, buffer: "", queue: Promise.resolve() };
  proc.stdout.on("data", (d: Buffer) => {
    session.buffer += d.toString();
  });
  proc.stderr.on("data", (d: Buffer) => {
    session.buffer += d.toString();
  });
  // Suppress cmd.exe's command-echo so captured output is just the command's own output,
  // not the input line (and the marker echo) bounced back at us.
  if (process.platform === "win32") proc.stdin.write("@echo off\n");
  proc.on("exit", () => {
    if (sessions.get(workspaceRoot) === session) sessions.delete(workspaceRoot);
  });
  sessions.set(workspaceRoot, session);
  return session;
}

export type ShellResult = {
  output: string;
  timedOut: boolean;
};

function executeCommand(
  session: ShellSession,
  command: string,
  timeoutMs: number
): Promise<ShellResult> {
  const marker = `__OMNIAI_DONE_${Math.random().toString(36).slice(2)}__`;
  session.buffer = "";
  session.proc.stdin.write(`${command}\n`);
  session.proc.stdin.write(`echo ${marker}\n`);

  const start = Date.now();
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const markerIndex = session.buffer.indexOf(marker);
      if (markerIndex !== -1) {
        clearInterval(poll);
        resolve({ output: session.buffer.slice(0, markerIndex).trim(), timedOut: false });
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(poll);
        resolve({ output: session.buffer.trim(), timedOut: true });
      }
    }, 100);
  });
}

/**
 * Runs a command in a shell that persists across calls for the same workspace root — `cd`,
 * environment variables, and background processes carry over, like a real terminal tab.
 * A command that never exits (a dev server left in the foreground) leaves the shell busy until
 * it finishes or the session is reset; that mirrors a real terminal too. Concurrent calls for
 * the same workspace are queued, not run in parallel.
 */
export async function runInPersistentShell(
  workspaceRoot: string,
  command: string,
  timeoutMs: number
): Promise<ShellResult> {
  const session = getSession(workspaceRoot);
  // Chain onto the session's queue so a second call arriving before the first resolves waits
  // its turn instead of resetting session.buffer out from under the in-flight command.
  const run = session.queue.then(() => executeCommand(session, command, timeoutMs));
  session.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetShell(workspaceRoot: string): void {
  const session = sessions.get(workspaceRoot);
  if (session) {
    session.proc.kill();
    sessions.delete(workspaceRoot);
  }
}
