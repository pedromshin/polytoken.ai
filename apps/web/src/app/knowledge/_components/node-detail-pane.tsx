"use client";

/**
 * node-detail-pane.tsx — the /knowledge detail pane on the LOCKED identity
 * (Phase 62 / SURF-03). Follows /files' house grammar: selection updates
 * this pane in place — the user never navigates away just to glance at a
 * node (taste checklist item 7 / anti-generic tell #7). The explicit "Open"
 * links remain for when they genuinely want the full surface.
 *
 * LAW 2 — a node's type badge is CHROME (polytoken's word, sans, no hue);
 * the VALUES are split by origin: an instance label, an email subject, a
 * sender address are the user's own material (serif + data-evidence); field
 * types, match status, confidence are polytoken speaking (sans, tabular for
 * numbers/dates).
 *
 * LAW 3 — the header swatch restates the node-kind key from filter-rail.tsx
 * (structure, never hue). The retired per-kind colour badges are gone.
 *
 * SECURITY (T-11-05): ALL DB-origin strings render as plain escaped React
 * text children. NO dangerouslySetInnerHTML anywhere in this file.
 *
 * Presentational — state injected via props from knowledge-graph.tsx.
 * No font-medium (500) — only 400/600.
 */

import * as React from "react";
import { format } from "date-fns";
import { MousePointerClick, X } from "lucide-react";
import Link from "next/link";

import { Button } from "@polytoken/ui/button";
import { ScrollArea } from "@polytoken/ui/scroll-area";

import type { KnowledgeNode } from "~/app/entities/[id]/_components/entity-knowledge";

import { NODE_TYPE_ROWS } from "./filter-rail";

// ---------------------------------------------------------------------------
// Type definitions for node data (mirrors GraphNode shapes from graph.ts)
// ---------------------------------------------------------------------------

interface EntityTypeData {
  readonly label: string;
  readonly slug?: string | null;
  readonly fields?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly instanceCount?: number;
  readonly [key: string]: unknown;
}

interface EntityTypeFieldData {
  readonly label: string;
  readonly fieldType?: string | null;
  readonly entityTypeId?: string | null;
  readonly entityTypeName?: string | null;
  readonly [key: string]: unknown;
}

interface EntityInstanceData {
  readonly label: string;
  readonly entityTypeId?: string | null;
  readonly entityTypeName?: string | null;
  readonly [key: string]: unknown;
}

interface EmailComponentData {
  readonly label: string;
  readonly emailId?: string | null;
  readonly emailSender?: string | null;
  readonly emailSubject?: string | null;
  readonly matched?: boolean | null;
  readonly matchedInstanceName?: string | null;
  readonly [key: string]: unknown;
}

interface EmailData {
  readonly label: string;
  readonly id: string;
  readonly sender?: string | null;
  readonly receivedAt?: string | null;
  readonly [key: string]: unknown;
}

interface KnowledgeNodeData {
  readonly label: string;
  readonly content?: string | null;
  readonly source?: string | null;
  readonly confidence?: number | null;
  readonly createdAt?: string | null;
  readonly [key: string]: unknown;
}

export interface SelectedNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NodeDetailPaneProps {
  readonly selectedNode: SelectedNode | null;
  readonly onClose: () => void;
  readonly onSelectNode: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Chrome vocabulary — one badge/link/row recipe, N call sites
// ---------------------------------------------------------------------------

/** Chrome badge naming the node's kind — sans, ink family, no hue (law 1/3). */
function KindBadge({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <span className="inline-flex w-fit items-center rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold tracking-[0.05em] text-faded uppercase">
      {children}
    </span>
  );
}

/** An action link — ink + underline, the only link language law 1 allows. */
function InkLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className="text-sm font-semibold text-ink underline underline-offset-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs font-semibold tracking-[0.05em] text-pencil uppercase">
        {label}
      </span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

/** The kind swatch from the filter rail, reused verbatim (one key, law 3). */
function kindSwatchClass(type: string): string | null {
  const row = NODE_TYPE_ROWS.find((r) => r.type === type);
  return row?.swatchClass ?? null;
}

/** Node kinds whose label is the user's own material (law 2 → serif). */
const EVIDENCE_LABEL_TYPES = new Set<string>(["entity_instance", "email"]);

// ---------------------------------------------------------------------------
// Per-type content blocks
// ---------------------------------------------------------------------------

function EntityTypeContent({ node }: { readonly node: SelectedNode }): React.ReactElement {
  const data = node as unknown as EntityTypeData;
  const fields = Array.isArray(data.fields)
    ? (data.fields as ReadonlyArray<{ id: string; label: string }>)
    : [];
  const instanceCount =
    typeof data.instanceCount === "number" ? data.instanceCount : 0;

  return (
    <div className="space-y-4">
      <KindBadge>Entity Type</KindBadge>

      {fields.length > 0 && (
        <div className="space-y-1.5">
          <p className="tabular text-2xs font-semibold tracking-[0.05em] text-pencil uppercase">
            Fields ({fields.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <span
                key={field.id}
                className="rounded-sm border border-hair bg-bright px-chip-x py-chip-y text-xs text-faded"
              >
                {field.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <InkLink href={`/entities?type=${node.id}`}>
          View {instanceCount} instances &rarr;
        </InkLink>
      </div>
    </div>
  );
}

function EntityTypeFieldContent({
  node,
  onSelectNode,
}: {
  readonly node: SelectedNode;
  readonly onSelectNode: (nodeId: string) => void;
}): React.ReactElement {
  const data = node as unknown as EntityTypeFieldData;

  return (
    <div className="space-y-4">
      <KindBadge>Field</KindBadge>

      {data.fieldType != null && (
        <DetailRow label="Type">{data.fieldType}</DetailRow>
      )}

      {data.entityTypeName != null && data.entityTypeId != null && (
        <DetailRow label="Belongs to">
          <button
            type="button"
            className="text-sm font-semibold text-ink underline underline-offset-2"
            onClick={() => {
              if (data.entityTypeId != null) {
                onSelectNode(data.entityTypeId);
              }
            }}
          >
            {data.entityTypeName}
          </button>
        </DetailRow>
      )}
    </div>
  );
}

function EntityInstanceContent({ node }: { readonly node: SelectedNode }): React.ReactElement {
  const data = node as unknown as EntityInstanceData;

  return (
    <div className="space-y-4">
      <KindBadge>Instance</KindBadge>

      {data.entityTypeName != null && (
        <DetailRow label="Entity Type">{data.entityTypeName}</DetailRow>
      )}

      <div>
        <InkLink href={`/entities/${node.id}`}>Open entity &rarr;</InkLink>
      </div>
    </div>
  );
}

function EmailComponentContent({ node }: { readonly node: SelectedNode }): React.ReactElement {
  const data = node as unknown as EmailComponentData;
  const emailId = typeof data.emailId === "string" ? data.emailId : null;

  return (
    <div className="space-y-4">
      <KindBadge>Component</KindBadge>

      {(data.emailSender != null || data.emailSubject != null) && (
        <DetailRow label="Email">
          {/* The sender/subject are the user's own mail — serif (law 2). */}
          <span data-evidence className="font-serif">
            {data.emailSender != null ? data.emailSender : ""}
            {data.emailSender != null && data.emailSubject != null ? " · " : ""}
            {data.emailSubject != null
              ? data.emailSubject.length > 40
                ? `${data.emailSubject.slice(0, 40)}…`
                : data.emailSubject
              : ""}
          </span>
        </DetailRow>
      )}

      <DetailRow label="Match status">
        {data.matched === true ? (
          data.matchedInstanceName != null ? (
            <span data-evidence className="font-serif">
              {data.matchedInstanceName}
            </span>
          ) : (
            "Matched"
          )
        ) : (
          "Unmatched"
        )}
      </DetailRow>

      {emailId != null && (
        <div>
          <InkLink href={`/emails/${emailId}`}>Open editor &rarr;</InkLink>
        </div>
      )}
    </div>
  );
}

function EmailContent({ node }: { readonly node: SelectedNode }): React.ReactElement {
  const data = node as unknown as EmailData;

  return (
    <div className="space-y-4">
      <KindBadge>Email</KindBadge>

      {/* Subject — the user's own mail, full and wrapping (law 2). */}
      <p data-evidence className="font-serif text-base leading-snug text-ink">
        {node.label}
      </p>

      {data.sender != null && (
        <DetailRow label="From">
          <span data-evidence className="font-serif">
            {data.sender}
          </span>
        </DetailRow>
      )}

      {data.receivedAt != null && (
        <DetailRow label="Received">
          <span className="tabular">{data.receivedAt}</span>
        </DetailRow>
      )}

      <div>
        <InkLink href={`/emails/${node.id}`}>Open editor &rarr;</InkLink>
      </div>
    </div>
  );
}

function KnowledgeNodeContent({ node }: { readonly node: SelectedNode }): React.ReactElement {
  const data = node as unknown as KnowledgeNodeData;

  // Build the KnowledgeNode shape for consistency with entity-knowledge.tsx
  const kn: KnowledgeNode = {
    id: node.id,
    title: node.label,
    content: typeof data.content === "string" ? data.content : null,
    source: typeof data.source === "string" ? data.source : null,
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    createdAt:
      typeof data.createdAt === "string" ? new Date(data.createdAt) : null,
  };

  return (
    <div className="space-y-4">
      <KindBadge>Knowledge Rule</KindBadge>

      {/* Rule body — polytoken's synthesis, its own sans voice.
          Plain escaped React text (T-11-05). */}
      {kn.content != null && (
        <p className="text-sm leading-relaxed text-faded">{kn.content}</p>
      )}

      {kn.source != null && (
        <DetailRow label="Source">
          <span className="rounded-sm border border-hair bg-bright px-chip-x py-chip-y text-xs text-faded">
            {kn.source}
          </span>
        </DetailRow>
      )}

      {kn.confidence != null && (
        <DetailRow label="Confidence">
          <span className="tabular">{Math.round(kn.confidence * 100)}%</span>
        </DetailRow>
      )}

      {kn.createdAt != null && (
        <DetailRow label="Created">
          <span className="tabular">{format(new Date(kn.createdAt), "PP")}</span>
        </DetailRow>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NodeDetailPane({
  selectedNode,
  onClose,
  onSelectNode,
}: NodeDetailPaneProps): React.ReactElement {
  const swatch = selectedNode != null ? kindSwatchClass(selectedNode.type) : null;
  const labelIsEvidence =
    selectedNode != null && EVIDENCE_LABEL_TYPES.has(selectedNode.type);

  return (
    <div
      role="complementary"
      aria-label="Node details"
      className="flex h-full w-full flex-col border-l border-hair bg-leaf"
    >
      {selectedNode == null ? (
        /* Empty state — teaches the pane's grammar: select updates in place */
        <div className="flex h-full flex-col items-center justify-center gap-2 p-panel text-center">
          <MousePointerClick className="size-5 text-pencil" aria-hidden />
          <p className="text-sm font-semibold text-ink">Nothing selected</p>
          <p className="text-sm text-faded">
            Click a node to inspect it here — the same click expands its
            neighbourhood on the board.
          </p>
        </div>
      ) : (
        /* Selected node content */
        <div className="flex h-full flex-col" aria-live="polite">
          {/* Header — kind swatch + label; close is desktop-only (the mobile
              Sheet ships its own corner close control). */}
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-hair px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {swatch != null && (
                <span className={`${swatch} shrink-0`} aria-hidden />
              )}
              {labelIsEvidence ? (
                <p
                  data-evidence
                  className="truncate font-serif text-base text-ink"
                >
                  {selectedNode.label}
                </p>
              ) : (
                <p className="truncate text-base font-semibold text-ink">
                  {selectedNode.label}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close detail panel"
              className="size-7 shrink-0 hidden md:inline-flex text-faded hover:bg-shade hover:text-ink"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>

          {/* Scrollable content */}
          <ScrollArea className="flex-1">
            <div className="w-full min-w-0 p-4">
              {selectedNode.type === "entity_type" && (
                <EntityTypeContent node={selectedNode} />
              )}
              {selectedNode.type === "entity_type_field" && (
                <EntityTypeFieldContent
                  node={selectedNode}
                  onSelectNode={onSelectNode}
                />
              )}
              {selectedNode.type === "entity_instance" && (
                <EntityInstanceContent node={selectedNode} />
              )}
              {selectedNode.type === "email_component" && (
                <EmailComponentContent node={selectedNode} />
              )}
              {selectedNode.type === "email" && (
                <EmailContent node={selectedNode} />
              )}
              {selectedNode.type === "knowledge_node" && (
                <KnowledgeNodeContent node={selectedNode} />
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
