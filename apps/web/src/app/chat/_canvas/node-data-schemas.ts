/**
 * node-data-schemas.ts — Zod boundary for canvas node.data payloads
 * (CANVAS-03, D-05, FOUND-2).
 *
 * Mirrors 23-01-PLAN.md's CANONICAL SNAPSHOT SHAPE (packages/api-client's
 * chat/canvas.ts `nodeDataSchema`) in lockstep: node.data carries ONLY
 * provenance/identity refs, NEVER genui spec content. `GenuiPanelNodeDataSchema`
 * additionally `.refine()`s against a top-level `spec`/`root` key — the same
 * shallow guard 23-01 applies to its generic `z.record` node.data — even
 * though `.strict()` alone already rejects an unrecognized `spec` key; the
 * explicit refine keeps the two schemas' intent verbatim-identical and gives
 * a clearer failure message than a generic "unrecognized key" error.
 *
 * Every object ends in `.strict()` (no extra keys tolerated at any node.data
 * boundary — matches packages/genui's Bedrock additionalProperties:false
 * convention, D-22).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// ProvenanceSchema — messageId/partIndex/runId ref (FOUND-5)
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z
  .object({
    messageId: z.string().uuid(),
    partIndex: z.number().int().min(0),
    runId: z.string().uuid().nullable(),
  })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------
// GenuiPanelNodeDataSchema — genui-panel node.data (provenance ref only, D-05)
// ---------------------------------------------------------------------------

export const GenuiPanelNodeDataSchema = z
  .object({
    provenance: ProvenanceSchema,
    turnIndex: z.number().int().min(0),
  })
  .strict()
  .refine(
    (data) => !("spec" in data) && !("root" in data),
    {
      message:
        "genui-panel node.data must not contain spec/root keys (D-05) — specs " +
        "rehydrate from chat_messages by provenance, never duplicated in node.data",
    },
  );

export type GenuiPanelNodeData = z.infer<typeof GenuiPanelNodeDataSchema>;

// ---------------------------------------------------------------------------
// ChatNodeDataSchema — chat node.data (conversation ref only)
// ---------------------------------------------------------------------------

export const ChatNodeDataSchema = z
  .object({
    conversationId: z.string().uuid(),
  })
  .strict();

export type ChatNodeData = z.infer<typeof ChatNodeDataSchema>;

// ---------------------------------------------------------------------------
// KnowledgePreviewNodeDataSchema — knowledge-preview node.data (focus node
// ref + optional label only, PREV-01)
// ---------------------------------------------------------------------------

export const KnowledgePreviewNodeDataSchema = z
  .object({
    focusNodeId: z.string().uuid(),
    label: z.string().max(80).optional(),
  })
  .strict();

export type KnowledgePreviewNodeData = z.infer<typeof KnowledgePreviewNodeDataSchema>;
