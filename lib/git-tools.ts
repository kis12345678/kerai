import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20_000;

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.message);
  }
}

export function createGitTools(workspaceRoot: string) {
  const gitStatus = tool({
    description: "Show the working tree status (staged, modified, and untracked files).",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { stdout } = await git(workspaceRoot, ["status", "--short", "--branch"]);
        return { status: stdout || "clean" };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const gitDiff = tool({
    description: "Show a diff of changes. Unstaged by default; set staged to see staged changes.",
    inputSchema: z.object({
      staged: z.boolean().default(false).describe("Show staged (--cached) changes instead"),
      path: z.string().optional().describe("Limit the diff to this file or directory"),
    }),
    execute: async ({ staged, path: relPath }) => {
      try {
        const args = ["diff", ...(staged ? ["--cached"] : []), ...(relPath ? ["--", relPath] : [])];
        const { stdout } = await git(workspaceRoot, args);
        return { diff: stdout || "no changes" };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const gitLog = tool({
    description: "Show recent commit history.",
    inputSchema: z.object({
      count: z.number().int().min(1).max(50).default(10),
    }),
    execute: async ({ count }) => {
      try {
        const { stdout } = await git(workspaceRoot, [
          "log",
          `-${count}`,
          "--pretty=format:%h %ad %s (%an)",
          "--date=short",
        ]);
        return { log: stdout || "no commits yet" };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const gitCommit = tool({
    description:
      "Stage and commit changes with the given message. Requires user approval. " +
      "Stages all modified/new tracked-directory files first (git add -A) unless addAll is false.",
    inputSchema: z.object({
      message: z.string(),
      addAll: z.boolean().default(true),
    }),
    execute: async ({ message, addAll }) => {
      try {
        if (addAll) await git(workspaceRoot, ["add", "-A"]);
        const { stdout } = await git(workspaceRoot, ["commit", "-m", message]);
        return { success: true, output: stdout };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { gitStatus, gitDiff, gitLog, gitCommit };
}
