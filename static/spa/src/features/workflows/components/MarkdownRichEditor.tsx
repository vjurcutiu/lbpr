import { useEffect, useRef } from "react";
import { Bold, Heading1, Heading2, Heading3, Highlighter, Italic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarkdownRichEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyInlineMarkdown(value: string) {
  const tokens: Array<{ token: string; html: string }> = [];
  const stash = (html: string) => {
    const token = `§§MDTOKEN${tokens.length}§§`;
    tokens.push({ token, html });
    return token;
  };

  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, (_match, code: string) => stash(`<code>${code}</code>`));
  html = html.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => stash(`<strong>${text}</strong>`));
  html = html.replace(/__([^_]+)__/g, (_match, text: string) => stash(`<strong>${text}</strong>`));
  html = html.replace(/==([^=\n]+)==/g, (_match, text: string) => stash(`<mark>${text}</mark>`));
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_match, prefix: string, text: string) => `${prefix}${stash(`<em>${text}</em>`)}`);
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_match, prefix: string, text: string) => `${prefix}${stash(`<em>${text}</em>`)}`);

  for (const { token, html: tokenHtml } of tokens) {
    html = html.replace(new RegExp(escapeRegex(token), "g"), tokenHtml);
  }

  return html;
}

function parseTable(lines: string[], startIndex: number) {
  const header = lines[startIndex];
  const divider = lines[startIndex + 1];
  if (!header?.includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider || "")) {
    return null;
  }

  const rows: string[][] = [];
  let cursor = startIndex;
  while (cursor < lines.length && lines[cursor]?.includes("|")) {
    if (cursor !== startIndex + 1) {
      rows.push(
        lines[cursor]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim())
      );
    }
    cursor += 1;
  }

  if (!rows.length) return null;
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")]);
  const [headRow, ...bodyRows] = normalizedRows;

  const head = `<thead><tr>${headRow.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
  const body = bodyRows.length
    ? `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";

  return {
    html: `<table>${head}${body}</table>`,
    nextIndex: cursor,
  };
}

export function markdownToEditableHtml(markdown: string) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let blockquote: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${applyInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length) {
      blocks.push(`<ul>${listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
    if (orderedItems.length) {
      blocks.push(`<ol>${orderedItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("")}</ol>`);
      orderedItems = [];
    }
  };

  const flushQuote = () => {
    if (!blockquote.length) return;
    blocks.push(`<blockquote>${blockquote.map((line) => `<p>${applyInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (codeLines) {
      if (/^```/.test(line.trim())) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushAll();
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      flushAll();
      blocks.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushAll();
      blocks.push(`<h${heading[1].length}>${applyInlineMarkdown(heading[2].trim())}</h${heading[1].length}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      orderedItems = [];
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      listItems = [];
      orderedItems.push(ordered[1]);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  if (codeLines) {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushAll();

  return blocks.join("") || "<p><br></p>";
}

function normalizeInlineText(value: string) {
  return String(value || "").replace(/\u00a0/g, " ");
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(inlineMarkdown).join("");

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return children ? `**${children}**` : "";
  if (tag === "em" || tag === "i") return children ? `*${children}*` : "";
  if (tag === "mark" || element.style.backgroundColor || element.style.background) return children ? `==${children}==` : "";
  if (tag === "code") return children ? `\`${children.replace(/`/g, "'")}\`` : "";

  return children;
}

function tableMarkdown(table: HTMLTableElement) {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.children).map((cell) => inlineMarkdown(cell).replace(/\n+/g, " ").trim())
  );
  if (!rows.length) return "";

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")]);
  const [header, ...body] = normalizedRows;
  const divider = Array(columnCount).fill("---");
  return [header, divider, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.textContent || "").trim();
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (tag === "h1") return `# ${inlineMarkdown(element).trim()}`;
  if (tag === "h2") return `## ${inlineMarkdown(element).trim()}`;
  if (tag === "h3") return `### ${inlineMarkdown(element).trim()}`;
  if (tag === "ul") {
    return Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child) => `- ${inlineMarkdown(child).trim()}`)
      .join("\n");
  }
  if (tag === "ol") {
    return Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => `${index + 1}. ${inlineMarkdown(child).trim()}`)
      .join("\n");
  }
  if (tag === "blockquote") {
    return Array.from(element.childNodes)
      .map(blockMarkdown)
      .join("\n")
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
  }
  if (tag === "pre") {
    return `\`\`\`\n${element.innerText.replace(/\n$/, "")}\n\`\`\``;
  }
  if (tag === "table") return tableMarkdown(element as HTMLTableElement);
  if (tag === "div" || tag === "p") return inlineMarkdown(element).trim();

  return inlineMarkdown(element).trim();
}

export function editableHtmlToMarkdown(root: HTMLElement) {
  return Array.from(root.childNodes)
    .map(blockMarkdown)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function runEditorCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function selectionIsInside(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const anchor = selection.anchorNode;
  return !!anchor && element.contains(anchor);
}

function insertHighlightedSelection(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selectionIsInside(editor)) return;

  const selectedText = selection.toString();
  if (!selectedText) return;

  runEditorCommand("insertHTML", `<mark>${escapeHtml(selectedText)}</mark>`);
}

export function MarkdownRichEditor({ value, onChange, disabled = false, ariaLabel = "Edit markdown output" }: MarkdownRichEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedMarkdownRef = useRef(value);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (document.activeElement === editor && value === lastEmittedMarkdownRef.current) {
      return;
    }

    editor.innerHTML = markdownToEditableHtml(value);
    lastEmittedMarkdownRef.current = value;
  }, [value]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = editableHtmlToMarkdown(editor);
    lastEmittedMarkdownRef.current = nextValue;
    onChange(nextValue);
  };

  const focusEditor = () => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
  };

  const applyBlock = (block: "h1" | "h2" | "h3") => {
    focusEditor();
    runEditorCommand("formatBlock", block);
    emitChange();
  };

  const applyInline = (command: "bold" | "italic") => {
    focusEditor();
    runEditorCommand(command);
    emitChange();
  };

  const applyHighlight = () => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    focusEditor();
    insertHighlightedSelection(editor);
    emitChange();
  };

  const toolbarItems = [
    { key: "bold", label: "Bold", icon: Bold, action: () => applyInline("bold") },
    { key: "italic", label: "Italic", icon: Italic, action: () => applyInline("italic") },
    { key: "h1", label: "H1", icon: Heading1, action: () => applyBlock("h1") },
    { key: "h2", label: "H2", icon: Heading2, action: () => applyBlock("h2") },
    { key: "h3", label: "H3", icon: Heading3, action: () => applyBlock("h3") },
    { key: "highlight", label: "Highlight", icon: Highlighter, action: applyHighlight },
  ];

  return (
    <div className="border-t border-border/70">
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 bg-muted/10 px-4 py-2 md:px-6">
        {toolbarItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2.5 text-xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={item.action}
              disabled={disabled}
              aria-label={item.label}
              title={item.label}
            >
              <Icon className="h-4 w-4" />
              <span className={cn("ml-1", item.key === "bold" || item.key === "italic" ? "hidden sm:inline" : "")}>{item.label}</span>
            </Button>
          );
        })}
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={emitChange}
        onBlur={emitChange}
        className={cn(
          "min-h-[520px] px-5 py-6 text-[15px] leading-7 outline-none md:px-8 md:py-8",
          "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]",
          "[&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.02em]",
          "[&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7",
          "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-6",
          "[&_li]:pl-1 [&_ol]:my-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_p]:my-3",
          "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3 [&_pre]:text-sm [&_pre]:leading-6",
          "[&_strong]:font-semibold [&_table]:my-5 [&_table]:w-full [&_table]:min-w-[560px] [&_table]:border-collapse [&_table]:text-sm",
          "[&_td]:border-t [&_td]:border-border/70 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-sm [&_td]:leading-6",
          "[&_th]:border-b [&_th]:border-border/70 [&_th]:bg-muted/30 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-muted-foreground",
          "[&_ul]:my-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2",
          "[&_mark]:rounded-md [&_mark]:bg-yellow-200/70 [&_mark]:px-1 [&_mark]:py-0.5 [&_mark]:text-foreground dark:[&_mark]:bg-yellow-500/30",
          disabled && "cursor-not-allowed opacity-70"
        )}
      />
    </div>
  );
}
