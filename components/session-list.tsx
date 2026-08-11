"use client";

import type { ChatSession } from "@/lib/chat-storage";

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onNew}
        className="mb-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-medium text-zinc-200 hover:bg-white/10"
      >
        + New chat
      </button>

      {sessions.map((session) => (
        <div
          key={session.id}
          className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
            session.id === activeId
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          }`}
        >
          <button
            onClick={() => onSelect(session.id)}
            className="min-w-0 flex-1 truncate text-left"
            title={session.title}
          >
            {session.title}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-600 opacity-100 hover:bg-red-500/20 hover:text-red-300 sm:opacity-0 sm:group-hover:opacity-100"
            title="Delete chat"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
