"use client";

import { type ReactNode } from "react";

// A deliberately small, dependency-free markdown renderer for chat messages.
// Supports the common cases (code blocks, inline code, bold/italic, links,
// headings, lists, blockquotes, hr) — enough to make model output readable
// without shipping a full markdown library or using dangerouslySetInnerHTML.

// Lines that begin a block construct — a paragraph must stop before these, or it would
// swallow headings, list items, blockquotes, and rules into its own text.
function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, code, bold, italic, link] = match;
    if (code !== undefined) {
      nodes.push(
        <code
          key={`${keyBase}-${key++}`}
          className="rounded bg-ink/70 px-1.5 py-0.5 font-mono text-[0.85em] text-accent"
        >
          {code.slice(1, -1)}
        </code>
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={`${keyBase}-${key++}`}>{renderInline(bold.slice(2, -2), `${keyBase}-b${key}`)}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={`${keyBase}-${key++}`}>{renderInline(italic.slice(1, -1), `${keyBase}-i${key}`)}</em>);
    } else if (link !== undefined) {
      const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(link);
      if (m) {
        // Only http(s)/mailto links are clickable — `javascript:` and other schemes render as
        // plain text (model output can be prompt-injected, so treat hrefs as untrusted).
        const href = safeHref(m[2]);
        if (href) {
          nodes.push(
            <a
              key={`${keyBase}-${key++}`}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent/90"
            >
              {renderInline(m[1], `${keyBase}-l${key}`)}
            </a>
          );
        } else {
          nodes.push(<span key={`${keyBase}-${key++}`}>{link}</span>);
        }
      } else {
        nodes.push(link);
      }
    }
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Block({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  let listStack: string[] = []; // "ul" | "ol" markers to merge adjacent list lines

  function flushList() {
    if (listStack.length > 0) {
      const type = listStack[0] === "ul" ? "ul" : "ol";
      const items = listStack.slice(1);
      listStack = [];
      blocks.push(
        <ul
          key={`list-${key++}`}
          className={`${type === "ol" ? "list-decimal" : "list-disc"} space-y-0.5 pl-5 text-sm leading-relaxed text-frost`}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li-${key}-${idx}`)}</li>
          ))}
        </ul>
      );
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushList();
      const lang = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(          <div key={`code-${key++}`} className="overflow-hidden rounded-lg border border-edge bg-ink/70">
          {lang && <div className="border-b border-edge px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-fog/60">{lang}</div>}
          <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-frost/90">
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const size =
        level === 1
          ? "text-base font-semibold"
          : level === 2
            ? "text-sm font-semibold"
            : "text-sm font-medium";
      blocks.push(
        <div key={`h-${key++}`} className={`${size} text-frost`}>
          {renderInline(heading[2], `h${level}-${key}`)}
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} className="border-edge" />);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      flushList();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={`q-${key++}`} className="border-l-2 border-accent/40 pl-3 text-sm italic text-fog">
          {renderInline(quoteLines.join(" "), `q-${key}`)}
        </blockquote>
      );
      continue;
    }

    // Unordered list item
    const ulItem = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ulItem) {
      if (listStack[0] !== "ul") flushList();
      listStack.push(ulItem[1]);
      i++;
      continue;
    }

    // Ordered list item
    const olItem = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (olItem) {
      if (listStack[0] !== "ol") flushList();
      listStack.push(olItem[1]);
      i++;
      continue;
    }

    flushList();

    // Blank line — paragraph separator
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-blank lines that aren't the start of another block
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^```/.test(lines[i]) && !isBlockStart(lines[i])) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <div key={`p-${key++}`} className="text-sm leading-relaxed text-frost">
        {renderInline(paraLines.join(" "), `p-${key}`)}
      </div>
    );
  }
  flushList();

  return <Block>{blocks}</Block>;
}
