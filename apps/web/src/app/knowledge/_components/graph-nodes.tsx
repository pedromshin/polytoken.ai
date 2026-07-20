"use client";

/**
 * graph-nodes.tsx — six custom React Flow node components for the knowledge
 * graph, on the LOCKED identity (Phase 62 / SURF-03).
 *
 * The card language is Phase 61's canvas card, inherited wholesale
 * (chat/_canvas/canvas-node-shell-class.ts — the sketch's `.card`):
 *   - flat `bg-bright` sheet (a card sits ABOVE the page ground, never on it)
 *   - `border-rule` hairline, hover is a RULE change (`rule-hi`), ZERO shadow
 *   - selection is an ink OUTLINE, never a ring (a ring's offset paints a
 *     white halo in dark — D-61-03-F)
 *
 * LAW 3 — node kind is carried by STRUCTURE, never hue. The retired per-kind
 * colour family is gone; kind lives on the LEFT-RULE axis Phase 61 named
 * (weight = how much of the user's own material the node carries):
 *   entity_type        4px   the taxonomy anchor the whole board hangs off
 *   entity_instance    2px   a value pulled from the user's own mail
 *   email              2px   the user's mail itself — raw evidence
 *   knowledge_node     2px double  a bound synthesis (the canvas's document rule)
 *   entity_type_field  1px   schema plumbing
 *   email_component    1px   a fragment of an email, not the evidence itself
 *
 * LAW 2 — an instance label and an email subject are the user's own material:
 * serif + data-evidence. Type/field/rule labels are polytoken's words: sans.
 *
 * Typography: text-sm font-semibold or text-xs ONLY — never font-medium.
 */

import { Box, Hash, Layers, Mail, Shapes, Share2 } from "lucide-react";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

// ---------------------------------------------------------------------------
// The shared card recipe — the sketch's `.card`, restated for this surface.
// Mirrors CANVAS_NODE_SHELL_BASE / CANVAS_NODE_SELECTED (chat/_canvas); the
// literal strings are repeated here because Tailwind v4 scans source for
// literal classes — a cross-surface import of a composed string is exactly
// the purge hazard `_vocabulary/tier.ts` documents.
// ---------------------------------------------------------------------------

const BASE =
  "flex items-center gap-2 overflow-hidden rounded-card border border-rule bg-bright px-3 cursor-pointer select-none transition-colors hover:border-rule-hi";

const SELECTED_OUTLINE = "outline-2 outline-offset-2 outline-ink";

/** Kind geometry — the left-rule weight axis (law 3: shape, never hue). */
const KIND_GEOMETRY = {
  entity_type: "border-l-4 border-l-ink",
  entity_type_field: "border-l border-l-ink",
  entity_instance: "border-l-2 border-l-ink",
  email: "border-l-2 border-l-ink",
  email_component: "border-l border-l-ink",
  knowledge_node: "border-l-2 border-l-ink border-double",
} as const;

function nodeClasses(
  kind: keyof typeof KIND_GEOMETRY,
  selected: boolean,
): string {
  return selected
    ? `${BASE} ${KIND_GEOMETRY[kind]} ${SELECTED_OUTLINE}`
    : `${BASE} ${KIND_GEOMETRY[kind]}`;
}

// ---------------------------------------------------------------------------
// entity_type — 160×48, the taxonomy anchor (heaviest rule)
// ---------------------------------------------------------------------------

export type EntityTypeNodeData = { readonly label: string } & Record<
  string,
  unknown
>;
export type EntityTypeNodeType = Node<EntityTypeNodeData, "entity_type">;

export const EntityTypeNode = memo(function EntityTypeNode({
  data,
  selected,
}: NodeProps<EntityTypeNodeType>) {
  return (
    <div
      style={{ width: 160, height: 48 }}
      className={nodeClasses("entity_type", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Entity Type: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Shapes className="size-4 shrink-0 text-faded" aria-hidden />
      <span className="truncate text-sm font-semibold text-ink">
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// entity_type_field — 128×32, schema plumbing (lightest rule)
// ---------------------------------------------------------------------------

export type EntityTypeFieldNodeData = { readonly label: string } & Record<
  string,
  unknown
>;
export type EntityTypeFieldNodeType = Node<
  EntityTypeFieldNodeData,
  "entity_type_field"
>;

export const EntityTypeFieldNode = memo(function EntityTypeFieldNode({
  data,
  selected,
}: NodeProps<EntityTypeFieldNodeType>) {
  return (
    <div
      style={{ width: 128, height: 32 }}
      className={nodeClasses("entity_type_field", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Field: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Hash className="size-3 shrink-0 text-pencil" aria-hidden />
      <span className="truncate text-xs text-faded">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// entity_instance — 160×44, a value from the user's own mail (serif, law 2)
// ---------------------------------------------------------------------------

export type EntityInstanceNodeData = {
  readonly label: string;
  readonly entityTypeName?: string | null;
} & Record<string, unknown>;
export type EntityInstanceNodeType = Node<
  EntityInstanceNodeData,
  "entity_instance"
>;

export const EntityInstanceNode = memo(function EntityInstanceNode({
  data,
  selected,
}: NodeProps<EntityInstanceNodeType>) {
  return (
    <div
      style={{ width: 160, height: 44 }}
      className={nodeClasses("entity_instance", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Instance: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Box className="size-4 shrink-0 text-faded" aria-hidden />
      <div className="min-w-0 flex-1">
        <div
          data-evidence
          className="tabular truncate font-serif text-sm text-ink"
        >
          {data.label}
        </div>
        {data.entityTypeName != null && (
          <div className="truncate text-2xs text-pencil">
            {data.entityTypeName}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// email_component — 128×36, a fragment of an email (lightest rule)
// ---------------------------------------------------------------------------

export type EmailComponentNodeData = { readonly label: string } & Record<
  string,
  unknown
>;
export type EmailComponentNodeType = Node<
  EmailComponentNodeData,
  "email_component"
>;

export const EmailComponentNode = memo(function EmailComponentNode({
  data,
  selected,
}: NodeProps<EmailComponentNodeType>) {
  return (
    <div
      style={{ width: 128, height: 36 }}
      className={nodeClasses("email_component", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Component: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Layers className="size-3 shrink-0 text-pencil" aria-hidden />
      <span className="truncate text-xs text-faded">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// email — 144×40, the user's mail itself (serif subject, law 2)
// ---------------------------------------------------------------------------

export type EmailNodeData = {
  readonly label: string;
  readonly senderDomain?: string | null;
} & Record<string, unknown>;
export type EmailNodeType = Node<EmailNodeData, "email">;

export const EmailNode = memo(function EmailNode({
  data,
  selected,
}: NodeProps<EmailNodeType>) {
  const truncated =
    data.label.length > 20 ? `${data.label.slice(0, 20)}…` : data.label;

  return (
    <div
      style={{ width: 144, height: 40 }}
      className={nodeClasses("email", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Email: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Mail className="size-4 shrink-0 text-faded" aria-hidden />
      <div className="min-w-0 flex-1">
        <div data-evidence className="truncate font-serif text-sm text-ink">
          {truncated}
        </div>
        {data.senderDomain != null && (
          <div className="truncate text-2xs text-pencil">
            {data.senderDomain}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// knowledge_node — 160×48, a bound synthesis (double rule, no glow — the
// identity is "flat surfaces, hairline rules, zero shadow anywhere")
// ---------------------------------------------------------------------------

export type KnowledgeNodeNodeData = {
  readonly label: string;
  readonly confidence?: number | null;
} & Record<string, unknown>;
export type KnowledgeNodeNodeType = Node<
  KnowledgeNodeNodeData,
  "knowledge_node"
>;

export const KnowledgeNodeNode = memo(function KnowledgeNodeNode({
  data,
  selected,
}: NodeProps<KnowledgeNodeNodeType>) {
  const confLabel =
    data.confidence != null ? `${Math.round(data.confidence * 100)}%` : null;

  return (
    <div
      style={{ width: 160, height: 48 }}
      className={nodeClasses("knowledge_node", selected)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Knowledge Rule: ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Share2 className="size-4 shrink-0 text-faded" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">
          {data.label}
        </div>
        {confLabel != null && (
          <div className="tabular truncate text-2xs text-pencil">
            {confLabel}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// nodeTypes map — passed to ReactFlow's nodeTypes prop
// ---------------------------------------------------------------------------

export const nodeTypes = {
  entity_type: EntityTypeNode,
  entity_type_field: EntityTypeFieldNode,
  entity_instance: EntityInstanceNode,
  email_component: EmailComponentNode,
  email: EmailNode,
  knowledge_node: KnowledgeNodeNode,
} as const;
