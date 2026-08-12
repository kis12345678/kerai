"use client";

export function ReasoningPart({ text, state }: { text: string; state?: "streaming" | "done" }) {
  if (!text.trim()) return null;

  return (
    <details className="rounded-xl border border-dashed border-edge bg-transparent px-4 py-2 text-xs" open={state === "streaming"}>
      <summary className="cursor-pointer list-none text-fog marker:content-none">
        🧠 {state === "streaming" ? "Thinking…" : "Thought process"}
      </summary>
      <div className="mt-2 whitespace-pre-wrap italic leading-relaxed text-fog">{text}</div>
    </details>
  );
}
