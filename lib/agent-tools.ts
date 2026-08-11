import { tool } from "ai";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runInPersistentShell } from "./persistent-shell";

const MAX_READ_BYTES = 200_000;
const MAX_SEARCH_MATCHES = 50;
const COMMAND_TIMEOUT_MS = 30_000;
export const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".omniai"]);

function resolveSafePath(root: string, relPath: string): string {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relPath || ".");
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path "${relPath}" escapes the workspace root`);
  }
  return target;
}

export function createAgentTools(workspaceRoot: string) {
  const listDirectory = tool({
    description: "List files and folders inside a directory of the workspace.",
    inputSchema: z.object({
      path: z.string().default(".").describe("Directory path relative to the workspace root"),
    }),
    execute: async ({ path: relPath }) => {
      try {
        const dir = resolveSafePath(workspaceRoot, relPath ?? ".");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return {
          entries: entries
            .filter((e) => !IGNORED_DIRS.has(e.name))
            .map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" })),
        };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const readFile = tool({
    description: "Read the text contents of a file in the workspace.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the workspace root"),
    }),
    execute: async ({ path: relPath }) => {
      try {
        const file = resolveSafePath(workspaceRoot, relPath);
        const stat = await fs.stat(file);
        if (stat.size > MAX_READ_BYTES) {
          return { error: `File too large to read (${stat.size} bytes, limit ${MAX_READ_BYTES})` };
        }
        const content = await fs.readFile(file, "utf8");
        return { content };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const searchFiles = tool({
    description:
      "Search for a text pattern across files in the workspace (case-insensitive substring match).",
    inputSchema: z.object({
      query: z.string(),
      path: z.string().default(".").describe("Subdirectory to search within"),
    }),
    execute: async ({ query, path: relPath }) => {
      try {
        const root = resolveSafePath(workspaceRoot, relPath ?? ".");
        const results: { file: string; line: number; text: string }[] = [];

        async function walk(dir: string) {
          if (results.length >= MAX_SEARCH_MATCHES) return;
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= MAX_SEARCH_MATCHES) return;
            if (IGNORED_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(full);
            } else if (entry.isFile()) {
              try {
                const stat = await fs.stat(full);
                if (stat.size > MAX_READ_BYTES) continue;
                const text = await fs.readFile(full, "utf8");
                const lines = text.split("\n");
                for (let i = 0; i < lines.length && results.length < MAX_SEARCH_MATCHES; i++) {
                  if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                    results.push({
                      file: path.relative(workspaceRoot, full),
                      line: i + 1,
                      text: lines[i].trim().slice(0, 200),
                    });
                  }
                }
              } catch {
                // skip unreadable/binary files
              }
            }
          }
        }

        await walk(root);
        return { matches: results, truncated: results.length >= MAX_SEARCH_MATCHES };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const writeFile = tool({
    description:
      "Create a new file or overwrite an existing file with the given content. Requires user approval.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async ({ path: relPath, content }) => {
      try {
        const file = resolveSafePath(workspaceRoot, relPath);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content, "utf8");
        return { success: true, path: relPath, bytesWritten: Buffer.byteLength(content, "utf8") };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const editFile = tool({
    description:
      "Replace an exact, unique text match inside a file with new text. Requires user approval.",
    inputSchema: z.object({
      path: z.string(),
      oldString: z.string().describe("Exact text to find; must appear exactly once in the file"),
      newString: z.string().describe("Text to replace it with"),
    }),
    execute: async ({ path: relPath, oldString, newString }) => {
      try {
        const file = resolveSafePath(workspaceRoot, relPath);
        const content = await fs.readFile(file, "utf8");
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) {
          return { error: "oldString not found in file" };
        }
        if (occurrences > 1) {
          return { error: `oldString is not unique (${occurrences} occurrences); include more surrounding context` };
        }
        const updated = content.replace(oldString, newString);
        await fs.writeFile(file, updated, "utf8");
        return { success: true, path: relPath };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const runCommand = tool({
    description:
      "Run a shell command in a persistent terminal scoped to the workspace root — cd, environment " +
      "variables, and background processes carry over between calls, just like a real terminal tab. " +
      "A command that doesn't exit (e.g. a dev server left in the foreground) leaves the terminal busy " +
      "until it finishes; background it (e.g. trailing `&` on POSIX, `start` on Windows) if you need the " +
      "terminal back. Requires user approval.",
    inputSchema: z.object({
      command: z.string(),
    }),
    execute: async ({ command }) => {
      try {
        const { output, timedOut } = await runInPersistentShell(workspaceRoot, command, COMMAND_TIMEOUT_MS);
        return {
          output: output.slice(0, 10_000),
          timedOut,
          ...(timedOut && {
            note: "Command did not finish within the timeout — it may still be running. The terminal stays busy until it exits.",
          }),
        };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { listDirectory, readFile, searchFiles, writeFile, editFile, runCommand };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
