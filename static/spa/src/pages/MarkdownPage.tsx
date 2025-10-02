// src/pages/MarkdownPage.tsx
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";

/**
 * Minimal, accessible, MD‑proof layout for legal docs.
 * - Uses ReactMarkdown + remark-gfm (tables, lists, links)
 * - Nice readable width, anchors on headings, subtle "prose" styles
 * - Dark-mode aware via your Tailwind CSS variables
 */
export default function MarkdownPage({
  title,
  updated,
  md,
}: {
  title: string;
  updated?: string;
  md: string;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <header className="mb-8 sm:mb-10">
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs border border-border bg-secondary text-secondary-foreground">
          <span className="opacity-75">Legal</span>
          <span className="opacity-40">•</span>
          <Link to="/" className="hover:underline">Home</Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
        {updated ? (
          <p className="text-muted-foreground text-sm mt-1">Last updated: {updated}</p>
        ) : null}
      </header>

      {/* Content */}
      <article className="card card-lg p-6 md:p-8">
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({node, ...props}) => <h2 id={slugify(String(props.children))} {...props} />,
              h3: ({node, ...props}) => <h3 id={slugify(String(props.children))} {...props} />,
              a:  ({node, ...props}) => <a target="_blank" rel="noreferrer noopener" {...props} />,
              table: ({node, ...props}) => <div className="overflow-x-auto -mx-1 md:mx-0"><table {...props} /></div>,
              code: ({inline, className, children, ...props}) => {
                if (inline) return <code className="inline-code" {...props}>{children}</code>;
                return (
                  <pre className="code-block" {...props}>
                    <code>{children}</code>
                  </pre>
                );
              }
            }}
          >
            {md}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}