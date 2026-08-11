import { promises as fs } from "node:fs";
import path from "node:path";
import { tool, embed, embedMany, cosineSimilarity, type EmbeddingModel } from "ai";
// EmbeddingModel is `string | EmbeddingModelV4 | ...` — not generic; alias for a resolved model instance.
type ResolvedEmbeddingModel = Exclude<EmbeddingModel, string>;
import { z } from "zod";
import { ollama } from "./ollama";
import { IGNORED_DIRS } from "./agent-tools";

const EMBEDDING_MODEL_ID = "nomic-embed-text";
const CHUNK_LINES = 40;
const MAX_INDEX_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const INDEX_DIR = ".omniai";
const INDEX_FILE = "embeddings-index.json";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".css", ".scss",
  ".html", ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".txt",
  ".yml", ".yaml", ".sh", ".ps1", ".sql", ".rb", ".php", ".xml", ".toml", ".ini",
]);

type Chunk = { startLine: number; endLine: number; text: string; embedding: number[] };
type IndexData = Record<string, { mtimeMs: number; chunks: Chunk[] }>;

function indexPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, INDEX_DIR, INDEX_FILE);
}

async function loadIndex(workspaceRoot: string): Promise<IndexData> {
  try {
    const raw = await fs.readFile(indexPath(workspaceRoot), "utf8");
    return JSON.parse(raw) as IndexData;
  } catch {
    return {};
  }
}

async function saveIndex(workspaceRoot: string, data: IndexData): Promise<void> {
  const dir = path.join(workspaceRoot, INDEX_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(indexPath(workspaceRoot), JSON.stringify(data), "utf8");
}

function chunkText(text: string): { startLine: number; endLine: number; text: string }[] {
  const lines = text.split("\n");
  const chunks: { startLine: number; endLine: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const end = Math.min(i + CHUNK_LINES, lines.length);
    const body = lines.slice(i, end).join("\n").trim();
    if (body) chunks.push({ startLine: i + 1, endLine: end, text: body });
  }
  return chunks;
}

async function collectFiles(root: string): Promise<{ rel: string; full: string; mtimeMs: number }[]> {
  const results: { rel: string; full: string; mtimeMs: number }[] = [];

  async function walk(dir: string) {
    if (results.length >= MAX_INDEX_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_INDEX_FILES) return;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_FILE_BYTES) continue;
          results.push({ rel: path.relative(root, full), full, mtimeMs: stat.mtimeMs });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(root);
  return results;
}

async function ensureIndex(
  workspaceRoot: string,
  model: ResolvedEmbeddingModel
): Promise<IndexData> {
  const index = await loadIndex(workspaceRoot);
  const files = await collectFiles(workspaceRoot);
  const seen = new Set<string>();

  for (const file of files) {
    seen.add(file.rel);
    const existing = index[file.rel];
    if (existing && existing.mtimeMs === file.mtimeMs) continue;

    const content = await fs.readFile(file.full, "utf8").catch(() => null);
    if (content === null) continue;
    const rawChunks = chunkText(content);
    if (rawChunks.length === 0) {
      delete index[file.rel];
      continue;
    }
    const { embeddings } = await embedMany({ model, values: rawChunks.map((c) => c.text) });
    index[file.rel] = {
      mtimeMs: file.mtimeMs,
      chunks: rawChunks.map((c, i) => ({ ...c, embedding: embeddings[i] })),
    };
  }

  for (const key of Object.keys(index)) {
    if (!seen.has(key)) delete index[key];
  }

  await saveIndex(workspaceRoot, index);
  return index;
}

export function createSemanticSearchTool(workspaceRoot: string) {
  const semanticSearch = tool({
    description:
      "Search the workspace by meaning rather than exact text — finds conceptually related code even " +
      "when the wording differs from the query. Builds a local embeddings index on first use (nomic-embed-text " +
      "via Ollama), cached at .omniai/embeddings-index.json and incrementally refreshed after that. Prefer " +
      "this over searchFiles when you don't know the exact string to look for.",
    inputSchema: z.object({
      query: z.string(),
      topK: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ query, topK }) => {
      try {
        const model = ollama.embeddingModel(EMBEDDING_MODEL_ID);
        const index = await ensureIndex(workspaceRoot, model);
        const { embedding: queryEmbedding } = await embed({ model, value: query });

        const scored: { file: string; startLine: number; endLine: number; text: string; score: number }[] = [];
        for (const [file, entry] of Object.entries(index)) {
          for (const chunk of entry.chunks) {
            scored.push({
              file,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              text: chunk.text.slice(0, 500),
              score: cosineSimilarity(queryEmbedding, chunk.embedding),
            });
          }
        }
        scored.sort((a, b) => b.score - a.score);

        return { matches: scored.slice(0, topK), filesIndexed: Object.keys(index).length };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { semanticSearch };
}
