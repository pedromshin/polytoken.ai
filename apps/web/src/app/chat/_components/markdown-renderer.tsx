"use client";

/**
 * markdown-renderer.tsx — sanitized assistant-markdown renderer (CHAT-07, D-28).
 *
 * Security contracts (threat_model T-22-10, T-22-11 in 22-03-PLAN.md):
 *   - rehype-raw is intentionally NEVER used. Without it, raw HTML embedded in
 *     model-generated markdown (e.g. `<img onerror=...>`) is rendered by
 *     react-markdown as inert escaped text — it never becomes a live DOM node.
 *   - rehype-sanitize runs as defense-in-depth, BEFORE rehype-highlight in the
 *     pipeline. Order matters: sanitizing first means the highlighter's own
 *     trusted `hljs`/`hljs-*` classNames (added after sanitize runs) are never
 *     stripped by the sanitize schema, while any attacker-controlled markup in
 *     the original tree is still cleaned.
 *   - Fenced code content is rendered as inert highlighted text only — never
 *     evaluated (T-22-11).
 *   - No raw-HTML-injection API is used anywhere in this file — content is
 *     always rendered as structured React elements produced by ReactMarkdown.
 *
 * Typography contract (22-UI-SPEC.md): markdown heading levels map into the
 * app's existing 2-weight system (400/600) — h1..h6 all render at the Heading
 * role (`text-base font-semibold`). No third weight is introduced.
 */

import type { ComponentPropsWithoutRef, JSX } from "react";
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Token-neutral syntax theme. Code blocks render inside a bg-muted `<pre>`
// wrapper (below); the highlighter's own theme colors the tokens within it.
import "highlight.js/styles/github-dark.css";

const HEADING_CLASS = "text-base font-semibold";
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** Builds a heading component for `Tag` that maps into the app's Heading role. */
function makeHeading(Tag: HeadingTag) {
  function Heading({
    children,
    ...props
  }: ComponentPropsWithoutRef<HeadingTag>): JSX.Element {
    return (
      <Tag className={HEADING_CLASS} {...props}>
        {children}
      </Tag>
    );
  }
  Heading.displayName = `MarkdownHeading(${Tag})`;
  return Heading;
}

function Paragraph({
  children,
  ...props
}: ComponentPropsWithoutRef<"p">): JSX.Element {
  return (
    <p className="text-sm leading-relaxed" {...props}>
      {children}
    </p>
  );
}

function Anchor({
  children,
  ...props
}: ComponentPropsWithoutRef<"a">): JSX.Element {
  return (
    <a
      className="text-primary underline"
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    >
      {children}
    </a>
  );
}

function Pre({
  children,
  ...props
}: ComponentPropsWithoutRef<"pre">): JSX.Element {
  return (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs"
      {...props}
    >
      {children}
    </pre>
  );
}

/** Fenced code (has a `language-*` class from remark-rehype) vs. inline code. */
function Code({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"code">): JSX.Element {
  const isFenced = typeof className === "string" && /language-/.test(className);
  if (isFenced) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-xs"
      {...props}
    >
      {children}
    </code>
  );
}

function Table({
  children,
  ...props
}: ComponentPropsWithoutRef<"table">): JSX.Element {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  );
}

function TableHeadCell({
  children,
  ...props
}: ComponentPropsWithoutRef<"th">): JSX.Element {
  return (
    <th
      className="border border-border px-2 py-1 text-left font-semibold"
      {...props}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  ...props
}: ComponentPropsWithoutRef<"td">): JSX.Element {
  return (
    <td className="border border-border px-2 py-1" {...props}>
      {children}
    </td>
  );
}

function UnorderedList({
  children,
  ...props
}: ComponentPropsWithoutRef<"ul">): JSX.Element {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm" {...props}>
      {children}
    </ul>
  );
}

function OrderedList({
  children,
  ...props
}: ComponentPropsWithoutRef<"ol">): JSX.Element {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm" {...props}>
      {children}
    </ol>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  h1: makeHeading("h1"),
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
  h5: makeHeading("h5"),
  h6: makeHeading("h6"),
  p: Paragraph,
  a: Anchor,
  pre: Pre,
  code: Code,
  table: Table,
  th: TableHeadCell,
  td: TableCell,
  ul: UnorderedList,
  ol: OrderedList,
};

export interface MarkdownRendererProps {
  readonly content: string;
}

/**
 * Renders assistant-turn markdown as sanitized, syntax-highlighted React
 * elements. Consumed by the message list (22-08) as a reusable primitive.
 */
export function MarkdownRenderer({
  content,
}: MarkdownRendererProps): JSX.Element {
  return (
    <div className="max-w-none text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
