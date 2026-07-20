/**
 * node-type-registry.ts — NODE_TYPE_REGISTRY + resolveNodeType allowlist
 * (CANVAS-03, FOUND-2).
 *
 * One registry contract, many instances (FOUND-2): id + Zod data schema +
 * allowlist semantics, same shape the component catalog (packages/genui's
 * COMPONENT_REGISTRY) and the tRPC procedure allowlist already instantiate.
 * `resolveNodeType` NEVER throws — an unregistered type resolves to an
 * "unknown" marker so the caller can render `UnknownNodeTypePlaceholder`
 * instead of crashing the canvas (T-23-05, D-04: "never breaks").
 */

import type { z } from "zod";

import {
  ChatNodeDataSchema,
  DocumentNodeDataSchema,
  EmailThreadNodeDataSchema,
  GenuiPanelNodeDataSchema,
  KnowledgePreviewNodeDataSchema,
  SourceNodeDataSchema,
} from "./node-data-schemas";

export interface NodeTypeRegistryEntry {
  readonly id: string;
  readonly dataSchema: z.ZodTypeAny;
  readonly description: string;
}

/**
 * NODE_TYPE_REGISTRY — the allowlist of node types this canvas session
 * recognizes. Component wiring (the module-level `nodeTypes` map React Flow
 * consumes) is assembled in plan 23-03; this registry holds only id + Zod
 * data schema + a short human description per FOUND-2's allowlist contract.
 */
export const NODE_TYPE_REGISTRY: Record<string, NodeTypeRegistryEntry> = {
  chat: {
    id: "chat",
    dataSchema: ChatNodeDataSchema,
    description:
      "Chat node — embeds the conversation's message list and composer.",
  },
  "genui-panel": {
    id: "genui-panel",
    dataSchema: GenuiPanelNodeDataSchema,
    description:
      "Genui-panel node — renders a genui_spec message part by provenance ref.",
  },
  "knowledge-preview": {
    id: "knowledge-preview",
    dataSchema: KnowledgePreviewNodeDataSchema,
    description:
      "Knowledge-preview node — renders a bounded, non-interactive knowledge-graph subgraph anchored on a focus node id.",
  },
  "email-thread": {
    id: "email-thread",
    dataSchema: EmailThreadNodeDataSchema,
    description:
      "Email-thread node — renders a real thread's subject/participants/summary anchored on a thread id, with Open-thread/Attach-chat actions.",
  },
  document: {
    id: "document",
    dataSchema: DocumentNodeDataSchema,
    description:
      "Document node — renders a stored document's title/generated date anchored on a document id, with an Open-document action into /documents/[id].",
  },
  source: {
    id: "source",
    dataSchema: SourceNodeDataSchema,
    description:
      "Source node — an auto-collected research source (RCNV-02/RSRCH-03): title/domain/excerpt from a chat_source_ledger capture, tier-marked suggested until promoted, with an Open-source external link.",
  },
};

export type ResolvedNodeType =
  | { readonly kind: "registered"; readonly entry: NodeTypeRegistryEntry }
  | { readonly kind: "unknown"; readonly nodeType: string };

/**
 * resolveNodeType — looks up `type` in NODE_TYPE_REGISTRY. Never throws: an
 * unregistered/legacy type resolves to `{ kind: "unknown", nodeType }`, the
 * signal the render path uses to fall back to `UnknownNodeTypePlaceholder`
 * (CANVAS-03, T-23-05).
 */
export function resolveNodeType(type: string): ResolvedNodeType {
  const entry = NODE_TYPE_REGISTRY[type];
  if (entry === undefined) {
    return { kind: "unknown", nodeType: type };
  }
  return { kind: "registered", entry };
}
