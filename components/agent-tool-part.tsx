"use client";

import { useState } from "react";

type ApprovalInfo = {
  id: string;
  isAutomatic?: boolean;
  approved?: boolean;
  reason?: string;
};

export type AnyToolPart = {
  type: string;
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: ApprovalInfo;
};

const READ_ONLY_TOOLS = new Set([
  "listDirectory",
  "readFile",
  "searchFiles",
  "semanticSearch",
  "gitStatus",
  "gitDiff",
  "gitLog",
  "webFetch",
  "webSearch",
  "browserNavigate",
  "browserGetText",
  "browserScreenshot",
  "getSystemStatus",
  "getLocalTime",
  "readClipboard",
]);

// Heuristic only — the approval gate is the real safeguard. This just flags commands worth a
// closer look before you click Approve (irreversible deletes, force-pushes, disk-level ops).
const RISKY_COMMAND_PATTERNS = [
  /\brm\s+(-\w*r\w*f|-\w*f\w*r)\b/i,
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sf]\b.*\/[sf]\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bshutdown\b/i,
  /\bmkfs\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

function isRiskyCommand(command: string | undefined): boolean {
  if (!command) return false;
  return RISKY_COMMAND_PATTERNS.some((re) => re.test(command));
}

function summarize(toolName: string, input: Record<string, unknown> | undefined): string {
  const p = (input?.path as string) ?? "";
  switch (toolName) {
    case "listDirectory":
      return `List ${p || "."}`;
    case "readFile":
      return `Read ${p}`;
    case "searchFiles":
      return `Search for "${input?.query as string}"`;
    case "writeFile":
      return `Write ${p}`;
    case "editFile":
      return `Edit ${p}`;
    case "runCommand":
      return `Run: ${input?.command as string}`;
    case "semanticSearch":
      return `Semantic search: "${input?.query as string}"`;
    case "gitStatus":
      return "Git status";
    case "gitDiff":
      return `Git diff${input?.staged ? " (staged)" : ""}`;
    case "gitLog":
      return "Git log";
    case "gitCommit":
      return `Git commit: "${input?.message as string}"`;
    case "webFetch":
      return `Fetch ${input?.url as string}`;
    case "webSearch":
      return `Search: "${input?.query as string}"`;
    case "browserNavigate":
      return `Open ${input?.url as string}`;
    case "browserGetText":
      return "Read page text";
    case "browserScreenshot":
      return "Screenshot page";
    case "browserClick":
      return `Click ${(input?.selector as string) ?? (input?.text as string) ?? ""}`;
    case "browserType":
      return `Type into ${input?.selector as string}`;
    case "browserPressKey":
      return `Press ${input?.key as string}`;
    case "getSystemStatus":
      return "Check PC status";
    case "getLocalTime":
      return "Check local date/time";
    case "readClipboard":
      return "Read clipboard";
    case "writeClipboard":
      return `Copy ${(input?.text as string)?.length ?? 0} chars to clipboard`;
    case "openInBrowser":
      return `Open ${input?.url as string} in browser`;
    default:
      return toolName;
  }
}

function icon(toolName: string): string {
  switch (toolName) {
    case "listDirectory":
      return "📁";
    case "readFile":
      return "📄";
    case "searchFiles":
      return "🔍";
    case "semanticSearch":
      return "🧭";
    case "writeFile":
      return "🆕";
    case "editFile":
      return "✏️";
    case "runCommand":
      return "⚡";
    case "gitStatus":
    case "gitDiff":
    case "gitLog":
      return "🌿";
    case "gitCommit":
      return "✅";
    case "webFetch":
      return "🌐";
    case "webSearch":
      return "🔎";
    case "browserNavigate":
    case "browserGetText":
      return "🧑‍💻";
    case "browserScreenshot":
      return "📸";
    case "browserClick":
    case "browserType":
    case "browserPressKey":
      return "🖱️";
    case "getSystemStatus":
      return "🖥️";
    case "getLocalTime":
      return "🕐";
    case "readClipboard":
      return "📋";
    case "writeClipboard":
      return "📋";
    case "openInBrowser":
      return "🖱️";
    default:
      return "🔧";
  }
}

export function AgentToolPart({
  part,
  onApprove,
  onDeny,
}: {
  part: AnyToolPart;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const toolName = part.type.replace(/^tool-/, "");
  const label = summarize(toolName, part.input);
  const isReadOnly = READ_ONLY_TOOLS.has(toolName);

  if (part.state === "approval-requested" && part.approval && !part.approval.isAutomatic) {
    const risky = toolName === "runCommand" && isRiskyCommand(part.input?.command as string | undefined);
    return (
      <div
        className={`rounded-xl border px-4 py-3 ${
          risky ? "border-red-500/40 bg-red-500/5" : "border-accent/30 bg-accent/5"
        }`}
      >
        <div
          className={`mb-2 flex items-center gap-2 text-sm font-medium ${
            risky ? "text-red-300" : "text-accent"
          }`}
        >
          <span>{icon(toolName)}</span>
          <span>Approval needed — {label}</span>
          {risky && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
              Looks destructive
            </span>
          )}
        </div>
        <ToolInputPreview toolName={toolName} input={part.input} />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onApprove(part.approval!.id)}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink shadow-accent transition-all hover:brightness-110"
          >
            Approve
          </button>
          <button
            onClick={() => onDeny(part.approval!.id)}
            className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-frost/90 hover:bg-edge"
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (part.state === "output-denied") {
    return (
      <div className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm text-fog">
        <span className="mr-2">{icon(toolName)}</span>
        {label} — denied
        {part.approval?.reason ? ` (${part.approval.reason})` : ""}
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm text-red-300">
        <span className="mr-2">{icon(toolName)}</span>
        {label} — error: {part.errorText}
      </div>
    );
  }

  if (part.state === "output-available") {
    const wroteHtmlApp =
      toolName === "writeFile" &&
      isHtmlPath(part.input?.path as string | undefined) &&
      typeof part.input?.content === "string" &&
      (part.output as { success?: boolean } | undefined)?.success;

    if (wroteHtmlApp) {
      return (
        <div className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm">
          <div className="mb-2 text-frost/75">
            <span className="mr-2">{icon(toolName)}</span>
            {label} — done
          </div>
          <HtmlAppPreview html={part.input!.content as string} />
        </div>
      );
    }

    if (toolName === "browserScreenshot") {
      const image = (part.output as { image?: string } | undefined)?.image;
      if (image) {
        return (
          <div className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm">
            <div className="mb-2 text-frost/75">
              <span className="mr-2">{icon(toolName)}</span>
              {label}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable asset */}
            <img src={image} alt="browser screenshot" className="max-h-96 w-full rounded-lg object-contain" />
          </div>
        );
      }
    }

    return (
      <details className="group rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm">
        <summary className="cursor-pointer list-none text-frost/75 marker:content-none">
          <span className="mr-2">{icon(toolName)}</span>
          {label}
          {isReadOnly ? "" : " — done"}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink/70 p-2 text-xs text-fog">
          {formatOutput(part.output)}
        </pre>
      </details>
    );
  }

  if (part.state === "approval-responded") {
    return (
      <div className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-xs text-fog">
        <span className="mr-2">{icon(toolName)}</span>
        {label} — {part.approval?.approved ? "approved" : "denied"}
        {part.approval?.isAutomatic ? " (auto)" : ""}, running…
      </div>
    );
  }

  // input-streaming / input-available (read-only tools mid-flight, or before approval state arrives)
  return (
    <div className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm text-fog">
      <span className="mr-2">{icon(toolName)}</span>
      {label}…
    </div>
  );
}

function ToolInputPreview({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown> | undefined;
}) {
  if (toolName === "writeFile") {
    const content = input?.content as string | undefined;
    if (isHtmlPath(input?.path as string | undefined) && content) {
      return <HtmlAppPreview html={content} />;
    }
    return (
      <pre className="max-h-56 overflow-auto rounded-lg bg-ink/70 p-2 text-xs text-frost/75">
        {content?.slice(0, 4000)}
      </pre>
    );
  }
  if (toolName === "editFile") {
    return (
      <div className="space-y-1.5 text-xs">
        <div className="rounded-lg bg-red-500/10 p-2 text-red-300">
          <div className="mb-1 font-medium">− old</div>
          <pre className="whitespace-pre-wrap">{(input?.oldString as string)?.slice(0, 2000)}</pre>
        </div>
        <div className="rounded-lg bg-accent/10 p-2 text-accent">
          <div className="mb-1 font-medium">+ new</div>
          <pre className="whitespace-pre-wrap">{(input?.newString as string)?.slice(0, 2000)}</pre>
        </div>
      </div>
    );
  }
  if (toolName === "runCommand") {
    return (
      <pre className="overflow-auto rounded-lg bg-ink/70 p-2 text-xs text-frost/90">
        $ {input?.command as string}
      </pre>
    );
  }
  if (toolName === "gitCommit") {
    return (
      <pre className="overflow-auto rounded-lg bg-ink/70 p-2 text-xs text-frost/90">
        {input?.message as string}
        {input?.addAll === false ? "" : "\n(stages all changes first)"}
      </pre>
    );
  }
  if (toolName === "browserClick" || toolName === "browserType" || toolName === "browserPressKey") {
    return (
      <pre className="overflow-auto rounded-lg bg-ink/70 p-2 text-xs text-frost/90">
        {JSON.stringify(input, null, 2)}
      </pre>
    );
  }
  return null;
}

function isHtmlPath(path: string | undefined): boolean {
  return /\.html?$/i.test(path ?? "");
}

function HtmlAppPreview({ html }: { html: string }) {
  const [tab, setTab] = useState<"preview" | "code">("preview");

  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <div className="flex items-center gap-1 border-b border-edge bg-ink/50 px-2 py-1.5">
        <button
          onClick={() => setTab("preview")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            tab === "preview" ? "bg-edge text-frost" : "text-fog/60 hover:text-frost"
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => setTab("code")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            tab === "code" ? "bg-edge text-frost" : "text-fog/60 hover:text-frost"
          }`}
        >
          Code
        </button>
      </div>
      {tab === "preview" ? (
        <iframe
          title="app preview"
          srcDoc={html}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          className="h-96 w-full border-0 bg-white"
        />
      ) : (
        <pre className="max-h-96 overflow-auto bg-ink/70 p-2 text-xs text-frost/75">{html}</pre>
      )}
    </div>
  );
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}
