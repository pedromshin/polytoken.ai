"use client";

/**
 * provenance-link.tsx — ProvenanceLink (TUI-02, 39-UI-SPEC.md's
 * "<ProvenanceLink>" section). The ONE shared citation-chip primitive:
 * consumed by ToolInvocationResultRow's citation chips this phase, and by
 * Phase 41's knowledge-preview canvas node later (decided once, used twice —
 * 39-CONTEXT.md).
 *
 * Route computed internally, NEVER trusted from a caller-supplied string —
 * `hrefFor` is a fixed 3-way switch, mirroring `use-data-bindings.ts`'s
 * (Phase 33) "compile-time switch, never model-authored" discipline applied
 * to route selection (T-39-05). A citation's own `route` field (if any) is
 * never passed to this component or to `<Link href>`.
 */

import * as React from "react";
import Link from "next/link";
import { Box, Mail, Share2 } from "lucide-react";

export type ProvenanceKind = "email" | "entity" | "knowledge";

export interface ProvenanceLinkProps {
  readonly kind: ProvenanceKind;
  readonly id: string;
  readonly label?: string;
}

const ICON_BY_KIND: Readonly<Record<ProvenanceKind, typeof Mail>> = {
  email: Mail,
  entity: Box,
  knowledge: Share2,
};

const CHIP_CLASS_NAME =
  "inline-flex max-w-[160px] items-center gap-1 rounded-pill border border-transparent bg-muted px-2 py-1 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

/**
 * hrefFor — the fixed kind+id -> path switch, encodeURIComponent-wrapped.
 * Exported so a future consumer (Phase 41) can reuse it without re-deriving
 * the routing table, and so this task's tests can exercise it directly.
 */
export function hrefFor(kind: ProvenanceKind, id: string): string {
  switch (kind) {
    case "email":
      return `/emails/${encodeURIComponent(id)}`;
    case "entity":
      return `/entities/${encodeURIComponent(id)}`;
    case "knowledge":
      return `/knowledge?focus=${encodeURIComponent(id)}`;
  }
}

/**
 * fallbackLabel — the label shown when the caller passes no explicit
 * `label` (the expected case for Phase 36/37's `ToolCitation(kind, id,
 * route)`, which carries no label field): "{Capitalized kind} · {first 8
 * chars of id}", e.g. "Email · a3f21b8e".
 */
export function fallbackLabel(kind: ProvenanceKind, id: string): string {
  const capitalizedKind = kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${capitalizedKind} · ${id.slice(0, 8)}`;
}

/**
 * ProvenanceLink — a real Next <Link> (never onClick-only) rendering a
 * small neutral-palette chip: icon-per-kind + truncating label. Zero
 * brand-accent (primary/teal) usage — muted/accent/ring only.
 */
export function ProvenanceLink({
  kind,
  id,
  label,
}: ProvenanceLinkProps): React.ReactElement {
  const Icon = ICON_BY_KIND[kind];
  return (
    <Link
      href={hrefFor(kind, id)}
      onClick={(event) => event.stopPropagation()}
      className={CHIP_CLASS_NAME}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label ?? fallbackLabel(kind, id)}</span>
    </Link>
  );
}
