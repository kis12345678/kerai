import { RequestHandler } from "express";
import { memory } from "../lib/memory.js";
import type { MemoryLayer } from "@shared/api";

/**
 * POST /api/memory — store a memory
 */
export const handleMemoryStore: RequestHandler = (req, res) => {
  const { layer, key, value, tags, metadata, expiresInMinutes } = req.body as {
    layer?: MemoryLayer;
    key?: string;
    value?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    expiresInMinutes?: number;
  };

  if (!layer || !key || !value) {
    res.status(400).json({ error: "layer, key, and value are required" });
    return;
  }

  const validLayers: MemoryLayer[] = ["short_term", "working", "long_term", "episodic"];
  if (!validLayers.includes(layer)) {
    res.status(400).json({ error: `Invalid layer. Must be one of: ${validLayers.join(", ")}` });
    return;
  }

  const entry = memory.store(layer, key, value, { tags, metadata, expiresInMinutes });
  if (!entry) {
    res.status(400).json({ error: "Memory blocked: contains sensitive data" });
    return;
  }

  res.status(201).json(entry);
};

/**
 * PUT /api/memory/upsert — upsert a memory (create or update)
 */
export const handleMemoryUpsert: RequestHandler = (req, res) => {
  const { layer, key, value, tags, metadata, expiresInMinutes } = req.body as {
    layer?: MemoryLayer;
    key?: string;
    value?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    expiresInMinutes?: number;
  };

  if (!layer || !key || !value) {
    res.status(400).json({ error: "layer, key, and value are required" });
    return;
  }

  const entry = memory.upsert(layer, key, value, { tags, metadata, expiresInMinutes });
  if (!entry) {
    res.status(400).json({ error: "Memory blocked: contains sensitive data" });
    return;
  }

  res.status(200).json(entry);
};

/**
 * GET /api/memory — list memories with optional filters
 */
export const handleMemoryList: RequestHandler = (req, res) => {
  const layer = req.query.layer as MemoryLayer | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  if (layer) {
    const entries = memory.getByLayer(layer, limit);
    res.status(200).json({ entries, total: entries.length, layer });
    return;
  }

  const entries = memory.getActive(limit);
  res.status(200).json({ entries, total: entries.length });
};

/**
 * GET /api/memory/search — search memories
 */
export const handleMemorySearch: RequestHandler = (req, res) => {
  const q = req.query.q as string;
  const layers = req.query.layers as string | undefined;
  const tags = req.query.tags as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  if (!q) {
    res.status(400).json({ error: "q (query) parameter is required" });
    return;
  }

  const entries = memory.search(q, {
    layers: layers ? (layers.split(",") as MemoryLayer[]) : undefined,
    tags: tags ? tags.split(",") : undefined,
    limit,
  });

  res.status(200).json({ entries, total: entries.length, query: q });
};

/**
 * GET /api/memory/:id — get a specific memory
 */
export const handleMemoryGet: RequestHandler = (req, res) => {
  const id = req.params.id as string;
  const entry = memory.getById(id);

  if (!entry) {
    res.status(404).json({ error: `Memory "${id}" not found` });
    return;
  }

  res.status(200).json(entry);
};

/**
 * PUT /api/memory/:id — update a memory
 */
export const handleMemoryUpdate: RequestHandler = (req, res) => {
  const id = req.params.id as string;
  const { value, tags, metadata } = req.body as {
    value?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };

  const entry = memory.update(id, { value, tags, metadata });
  if (!entry) {
    res.status(404).json({ error: `Memory "${id}" not found or blocked sensitive data` });
    return;
  }

  res.status(200).json(entry);
};

/**
 * DELETE /api/memory/:id — delete a memory
 */
export const handleMemoryDelete: RequestHandler = (req, res) => {
  const id = req.params.id as string;
  const deleted = memory.delete(id);

  if (!deleted) {
    res.status(404).json({ error: `Memory "${id}" not found` });
    return;
  }

  res.status(200).json({ message: "Memory deleted", id });
};

/**
 * POST /api/memory/forget — forget memories matching a pattern
 */
export const handleMemoryForget: RequestHandler = (req, res) => {
  const { pattern } = req.body as { pattern?: string };

  if (!pattern) {
    res.status(400).json({ error: "pattern is required" });
    return;
  }

  const count = memory.forget(pattern);
  res.status(200).json({ message: `Forgot ${count} memories matching "${pattern}"`, count });
};

/**
 * POST /api/memory/clear — clear all memories in a layer
 */
export const handleMemoryClear: RequestHandler = (req, res) => {
  const { layer } = req.body as { layer?: MemoryLayer };

  if (!layer) {
    res.status(400).json({ error: "layer is required" });
    return;
  }

  const count = memory.clearLayer(layer);
  res.status(200).json({ message: `Cleared ${count} memories from ${layer}`, count });
};

/**
 * POST /api/memory/prune — remove expired memories
 */
export const handleMemoryPrune: RequestHandler = (_req, res) => {
  const count = memory.prune();
  res.status(200).json({ message: `Pruned ${count} expired memories`, count });
};

/**
 * GET /api/memory/stats — get memory statistics
 */
export const handleMemoryStats: RequestHandler = (_req, res) => {
  const stats = memory.getStats();
  res.status(200).json(stats);
};
