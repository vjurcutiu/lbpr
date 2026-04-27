import { useEffect, useRef, useState } from "react";
import { Bold, ChevronDown, Heading1, Italic, List, ListOrdered, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MarkdownEditorSelection = {
  contentBefore: string;
  selectedContent: string;
  contentAfter: string;
  selectedText: string;
};

type MarkdownRichEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  onAiEditSelection?: (selection: MarkdownEditorSelection) => void;
  aiEditDisabled?: boolean;
  aiEditBusy?: boolean;
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

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
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


function hasBlockChild(element: HTMLElement) {
  return Array.from(element.children).some((child) => /^(blockquote|div|h[1-6]|ol|p|pre|table|ul)$/i.test(child.tagName));
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.textContent || "").trim();
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  const headingMatch = tag.match(/^h([1-6])$/);
  if (headingMatch) return `${"#".repeat(Number(headingMatch[1]))} ${inlineMarkdown(element).trim()}`;
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
  if (tag === "div" || tag === "p") {
    if (hasBlockChild(element)) {
      return Array.from(element.childNodes)
        .map(blockMarkdown)
        .map((block) => block.trim())
        .filter(Boolean)
        .join("\n\n");
    }
    return inlineMarkdown(element).trim();
  }

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

type HeadingBlock = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type ListBlock = "bulleted" | "numbered";

const HEADING_BLOCKS: Array<{ value: HeadingBlock; label: string; helper: string }> = [
  { value: "h1", label: "H1", helper: "Page title" },
  { value: "h2", label: "H2", helper: "Section" },
  { value: "h3", label: "H3", helper: "Subsection" },
  { value: "h4", label: "H4", helper: "Detail heading" },
  { value: "h5", label: "H5", helper: "Small heading" },
  { value: "h6", label: "H6", helper: "Label heading" },
];

function runEditorCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function closestEditableBlock(node: Node | null, editor: HTMLElement) {
  let current: HTMLElement | null = node?.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node?.parentElement || null;

  while (current && current !== editor) {
    if (/^(h[1-6]|p|div|li)$/i.test(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function selectedEditableBlocks(editor: HTMLElement, range: Range | null) {
  if (!range || !rangeIsInside(editor, range)) return [];

  const blocks = new Set<HTMLElement>();
  const addBlock = (node: Node | null) => {
    const block = closestEditableBlock(node, editor);
    if (block) blocks.add(block);
  };

  addBlock(range.startContainer);
  addBlock(range.endContainer);

  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        try {
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } catch {
          return NodeFilter.FILTER_REJECT;
        }
      },
    }
  );

  while (walker.nextNode()) {
    addBlock(walker.currentNode);
  }

  return Array.from(blocks);
}

function uniformSelectedHeading(editor: HTMLElement, range: Range | null): HeadingBlock | null {
  const blocks = selectedEditableBlocks(editor, range);
  if (!blocks.length) return null;

  const firstTag = blocks[0].tagName.toLowerCase();
  if (!/^h[1-6]$/.test(firstTag)) return null;

  return blocks.every((block) => block.tagName.toLowerCase() === firstTag)
    ? (firstTag as HeadingBlock)
    : null;
}

function selectionIsInside(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return !!anchor && !!focus && element.contains(anchor) && element.contains(focus);
}

function makeSelectionMarker(token: string) {
  const marker = document.createElement("span");
  marker.setAttribute("data-lbp-selection-marker", "true");
  marker.textContent = token;
  return marker;
}

function removeNode(node: Node | null) {
  if (node?.parentNode) {
    node.parentNode.removeChild(node);
  }
}

function rangeIsInside(element: HTMLElement, range: Range | null) {
  if (!range) return false;
  return element.contains(range.startContainer) && element.contains(range.endContainer);
}

function selectedMarkdownFromRange(editor: HTMLElement, range: Range): MarkdownEditorSelection | null {
  if (range.collapsed || !range.toString().trim()) return null;

  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const startToken = `%%LBP_SELECTION_START_${id}%%`;
  const endToken = `%%LBP_SELECTION_END_${id}%%`;
  const startMarker = makeSelectionMarker(startToken);
  const endMarker = makeSelectionMarker(endToken);
  const selectedText = range.toString();

  try {
    const endRange = range.cloneRange();
    endRange.collapse(false);
    endRange.insertNode(endMarker);

    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(startMarker);

    const markedMarkdown = editableHtmlToMarkdown(editor);
    const startIndex = markedMarkdown.indexOf(startToken);
    const endIndex = markedMarkdown.indexOf(endToken);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return null;

    const selectedStart = startIndex + startToken.length;
    const selectedContent = markedMarkdown.slice(selectedStart, endIndex);
    if (!selectedContent.trim()) return null;

    return {
      contentBefore: markedMarkdown.slice(0, startIndex),
      selectedContent,
      contentAfter: markedMarkdown.slice(endIndex + endToken.length),
      selectedText,
    };
  } finally {
    removeNode(startMarker);
    removeNode(endMarker);
  }
}

export function MarkdownRichEditor({ value, onChange, disabled = false, ariaLabel = "Edit markdown output", onAiEditSelection, aiEditDisabled = false, aiEditBusy = false }: MarkdownRichEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedMarkdownRef = useRef(value);
  const [hasSelectedText, setHasSelectedText] = useState(false);

  const updateSavedSelection = (range: Range | null) => {
    savedRangeRef.current = range ? range.cloneRange() : null;
    setHasSelectedText(!!range && !range.collapsed && range.toString().trim().length > 0);
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selectionIsInside(editor)) {
      updateSavedSelection(null);
      return;
    }
    updateSavedSelection(selection.getRangeAt(0));
  };

  const restoreSelection = () => {
    const editor = editorRef.current;
    const range = savedRangeRef.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) return;

    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    selection.addRange(range);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (document.activeElement === editor && value === lastEmittedMarkdownRef.current) {
      return;
    }

    updateSavedSelection(null);
    editor.innerHTML = markdownToEditableHtml(value);
    lastEmittedMarkdownRef.current = value;
  }, [value]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount || !selectionIsInside(editor)) return;
      updateSavedSelection(selection.getRangeAt(0));
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = editableHtmlToMarkdown(editor);
    lastEmittedMarkdownRef.current = nextValue;
    onChange(nextValue);
    saveSelection();
  };

  const focusEditor = () => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
    restoreSelection();
  };

  const applyBlock = (block: HeadingBlock) => {
    focusEditor();

    const editor = editorRef.current;
    const selection = window.getSelection();
    const range = editor && selection?.rangeCount && selectionIsInside(editor)
      ? selection.getRangeAt(0)
      : null;
    const nextBlock = editor && uniformSelectedHeading(editor, range) === block ? "p" : block;

    runEditorCommand("formatBlock", nextBlock);
    emitChange();
  };

  const applyInline = (command: "bold" | "italic") => {
    focusEditor();
    runEditorCommand(command);
    emitChange();
  };

  const applyList = (list: ListBlock) => {
    focusEditor();
    runEditorCommand(list === "bulleted" ? "insertUnorderedList" : "insertOrderedList");
    emitChange();
  };

  const captureAiEditSelection = () => {
    const editor = editorRef.current;
    if (!editor || disabled || !onAiEditSelection) return;

    const currentSelection = window.getSelection();
    const currentRange = currentSelection?.rangeCount && selectionIsInside(editor)
      ? currentSelection.getRangeAt(0).cloneRange()
      : null;
    const range = rangeIsInside(editor, currentRange) && !currentRange?.collapsed
      ? currentRange
      : rangeIsInside(editor, savedRangeRef.current)
        ? savedRangeRef.current?.cloneRange() || null
        : null;
    if (!range || range.collapsed) return;

    const selection = selectedMarkdownFromRange(editor, range);
    if (!selection) return;

    const nextValue = editableHtmlToMarkdown(editor);
    lastEmittedMarkdownRef.current = nextValue;
    onChange(nextValue);
    onAiEditSelection(selection);
  };


  const inlineToolbarItems = [
    { key: "bold", label: "Bold", icon: Bold, action: () => applyInline("bold") },
    { key: "italic", label: "Italic", icon: Italic, action: () => applyInline("italic") },
  ];

  const listToolbarItems = [
    { key: "bulleted-list", label: "Bullets", icon: List, action: () => applyList("bulleted") },
    { key: "numbered-list", label: "Numbered", icon: ListOrdered, action: () => applyList("numbered") },
  ];

  return (
    <div className="border-t border-border/70">
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 bg-muted/10 px-4 py-2 md:px-6">
        {inlineToolbarItems.map((item) => {
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
              <span className="ml-1 hidden sm:inline">{item.label}</span>
            </Button>
          );
        })}
        <DropdownMenu onOpenChange={(open) => {
          if (open) saveSelection();
        }}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2.5 text-xs"
              onMouseDown={(event) => {
                event.preventDefault();
                saveSelection();
              }}
              onPointerDownCapture={saveSelection}
              disabled={disabled}
              aria-label="Heading"
              title="Heading"
            >
              <Heading1 className="h-4 w-4" />
              <span className="ml-1">Heading</span>
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 rounded-2xl">
            {HEADING_BLOCKS.map((item) => (
              <DropdownMenuItem
                key={item.value}
                className="items-start rounded-xl px-2 py-2"
                disabled={disabled}
                onSelect={() => applyBlock(item.value)}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium leading-5 text-foreground">{item.label}</span>
                  <span className="text-[11px] leading-4 text-muted-foreground">{item.helper}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {listToolbarItems.map((item) => {
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
              <span className="ml-1 hidden sm:inline">{item.label}</span>
            </Button>
          );
        })}
        {onAiEditSelection ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "inline-flex rounded-full",
                  (disabled || aiEditDisabled || aiEditBusy || !hasSelectedText) && "cursor-not-allowed"
                )}
                tabIndex={0}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-2.5 text-xs disabled:opacity-100",
                    "hover:bg-primary/10 hover:text-primary",
                    "disabled:text-muted-foreground disabled:hover:bg-transparent"
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    saveSelection();
                  }}
                  onPointerDownCapture={saveSelection}
                  onClick={captureAiEditSelection}
                  disabled={disabled || aiEditDisabled || aiEditBusy || !hasSelectedText}
                  aria-label="Edit selected text with AI"
                >
                  <Sparkles
                    className={cn(
                      "h-4 w-4 text-primary transition-opacity",
                      (disabled || aiEditDisabled || aiEditBusy || !hasSelectedText) && "opacity-40"
                    )}
                  />
                  <span className="ml-1 hidden sm:inline">{aiEditBusy ? "Editing" : "Edit with AI"}</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="rounded-xl px-3 py-2 text-xs shadow-lg">
              Select text and then edit it with AI
            </TooltipContent>
          </Tooltip>
        ) : null}
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
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={emitChange}
        className={cn(
          "min-h-[520px] px-5 py-6 text-[15px] leading-7 outline-none md:px-8 md:py-8",
          "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]",
          "[&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.02em]",
          "[&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7",
          "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-6",
          "[&_h4]:mb-2 [&_h4]:mt-5 [&_h4]:text-[15px] [&_h4]:font-semibold [&_h4]:leading-6",
          "[&_h5]:mb-2 [&_h5]:mt-4 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:leading-6",
          "[&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-[0.12em] [&_h6]:text-muted-foreground",
          "[&_li]:pl-1 [&_ol]:my-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_p]:my-3",
          "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3 [&_pre]:text-sm [&_pre]:leading-6",
          "[&_strong]:font-semibold [&_table]:my-5 [&_table]:w-full [&_table]:min-w-[560px] [&_table]:border-collapse [&_table]:text-sm",
          "[&_td]:border-t [&_td]:border-border/70 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-sm [&_td]:leading-6",
          "[&_th]:border-b [&_th]:border-border/70 [&_th]:bg-muted/30 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-muted-foreground",
          "[&_ul]:my-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2",
          disabled && "cursor-not-allowed opacity-70"
        )}
      />
    </div>
  );
}
