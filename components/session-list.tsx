"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSession } from "@/lib/chat-storage";

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onExport,
}: {
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  // Enter commits the rename, and the input unmounting then fires blur — the blur handler
  // closes over the old editingId and would commit a second time. This ref makes commit
  // idempotent per rename session.
  const committedRef = useRef<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;

  useEffect(() => {
    if (editingId) editRef.current?.select();
  }, [editingId]);

  function startRename(session: ChatSession) {
    committedRef.current = null;
    setEditingId(session.id);
    setDraft(session.title);
  }

  function commitRename() {
    const id = editingId;
    if (!id) return;
    if (committedRef.current === id) return;
    committedRef.current = id;
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onNew}
        className="mb-1 rounded-lg border border-edge bg-surface px-3 py-2 text-left text-sm font-medium text-frost/90 hover:bg-edge"
      >
        + New chat
      </button>

      <div className="relative mb-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          className="w-full rounded-lg border border-edge bg-ink/60 px-2.5 py-1.5 pl-7 text-xs text-frost/90 placeholder:text-fog/50 focus:border-accent/60 focus:outline-none"
        />
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fog/50">🔍</span>
      </div>

      {filtered.length === 0 && (
        <div className="px-2 py-3 text-center text-xs text-fog/50">
          {sessions.length === 0 ? "No conversations yet." : "No chats match that search."}
        </div>
      )}

      {filtered.map((session) => (
        <div
          key={session.id}
          className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            session.id === activeId
              ? "bg-edge text-frost"
              : "text-fog hover:bg-surface hover:text-frost"
          }`}
        >
          {editingId === session.id ? (
            <input
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              className="min-w-0 flex-1 rounded border border-accent/40 bg-ink/70 px-1.5 py-0.5 text-xs text-frost focus:outline-none"
            />
          ) : (
            <button
              onClick={() => onSelect(session.id)}
              onDoubleClick={() => startRename(session)}
              className="min-w-0 flex-1 truncate text-left"
              title={`${session.title} (double-click to rename)`}
            >
              {session.title}
            </button>
          )}

          {editingId !== session.id && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(session);
                }}
                className="rounded px-1.5 py-0.5 text-xs text-fog/50 hover:bg-edge hover:text-frost"
                title="Rename"
              >
                ✏️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExport(session.id);
                }}
                className="rounded px-1.5 py-0.5 text-xs text-fog/50 hover:bg-edge hover:text-frost"
                title="Export as markdown"
              >
                ⬇️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
                className="rounded px-1.5 py-0.5 text-xs text-fog/50 hover:bg-red-500/20 hover:text-red-300"
                title="Delete chat"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
