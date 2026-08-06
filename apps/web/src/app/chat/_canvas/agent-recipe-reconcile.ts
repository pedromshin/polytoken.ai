/**
 * agent-recipe-reconcile.ts — the PURE client half of the agent-named recipe
 * seam (Phase 73C-R3). Stream 73C-R3 landed the listener `emit_canvas_recipe`
 * tool that, behind `CANVAS_EMIT_TOOL_ENABLED`, finalizes into a persisted
 * `canvas_recipe` message part of the frozen shape
 * `{ type, name, nodeKeys, edgeKeys[, sourceRef] }`
 * (run_chat_turn_tool_loop.py `_build_canvas_recipe_part`). This module is the
 * counterpart of `collectAgentCodeIslandPlans` (agent-code-island-reconcile.ts):
 * it turns that part into a createable plan the chat-canvas reconcile effect
 * feeds to the owner-gated `canvasRecipes.create` mutation.
 *
 * RE-GROUNDING (the same posture every agent-canvas seam takes): the model's
 * part NAMES which keys belong to the recipe, but the client validates every
 * key against ITS OWN live canvas — a nodeKey that is not a present FlowNode id
 * is dropped, an edgeKey that is not a present edge id is dropped, and a part
 * whose nodeKeys ALL fail resolution yields no plan at all (fail-closed,
 * mirroring the LCAN "both endpoints must exist" posture). An agent can only
 * name what is actually on the user's canvas.
 *
 * IDEMPOTENCY (dedupe key: conversation + name): `canvas_recipes` has no
 * provenance column, so the deterministic-id trick the node/island seams use is
 * unavailable — instead the plan collector dedupes against the conversation's
 * ALREADY-FETCHED `canvasRecipes.list` rows by trimmed name. Once the async
 * runner creates the row and invalidates the list, the refetched data contains
 * the name → the same part yields no plan on every later pass. Two same-name
 * parts in one pass collapse to one plan (first wins) for the same reason. The
 * plan is PURE (no network); the create + invalidate glue lives in
 * chat-canvas.tsx, exactly like the agent code-island runner.
 */

import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import type { MessagePart } from "../_hooks/use-chat-stream";
import type { ChatHistoryRow } from "../_hooks/use-conversation-controller";

/** The slice of a `canvasRecipes.list` row the dedupe needs. Kept structural
 * (not a router-type import) so the collector stays trivially testable —
 * mirrors recipe-overlay.tsx's `RecipeLike` reasoning. */
export interface ExistingRecipeLike {
  readonly name: string;
}

/** The tRPC boundary's own name bound (canvasRecipes.create `recipeNameSchema`
 * max). The listener already caps at 120; this defensive re-cap keeps a
 * hand-crafted over-long part from bouncing off the zod gate with a throw. */
const MAX_RECIPE_NAME_CHARS = 200;

/** A createable plan for one `canvas_recipe` part: exactly the
 * `canvasRecipes.create` input minus `conversationId` (supplied by the caller),
 * plus the runner's in-flight dedup key. */
export interface AgentRecipePlan {
  /** `{messageId}:{partIndex}` — the runner's in-flight dedup key so a plan's
   * create fires at most once per session while the mutation is pending. */
  readonly provenanceKey: string;
  readonly name: string;
  readonly nodeKeys: readonly string[];
  readonly edgeKeys: readonly string[];
  readonly sourceRef?: Readonly<Record<string, unknown>>;
}

/** Keep only string keys present in `presentIds`, deduped (order-preserving).
 * Never trusts the part's keys — presence on the live canvas is the gate. */
function resolvePresentKeys(
  keys: unknown,
  presentIds: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || !presentIds.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Narrow an unknown to a plain object (the shape `sourceRef` must have to be
 * forwarded to `canvasRecipes.create`'s opaque-record column). */
function asPlainRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * collectAgentRecipePlans — every ACTIVE turn's `canvas_recipe` part that
 * (a) is not already named by an existing recipe on this conversation (the
 * post-turn refetch idempotency gate) and (b) re-grounds to ≥1 present
 * nodeKey. Pure; never mutates its inputs and never touches the network.
 *
 * `nodes`/`edges` are the CURRENT canvas state (the key-validation reads
 * them); `existingRecipes` is the already-fetched `canvasRecipes.list` data
 * (the by-name dedupe reads it). A part with an empty/unusable name, or whose
 * nodeKeys all resolve to nothing, is skipped — never created broken.
 */
export function collectAgentRecipePlans(
  historyRows: readonly ChatHistoryRow[],
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  existingRecipes: readonly ExistingRecipeLike[],
): AgentRecipePlan[] {
  const presentNodeIds = new Set(nodes.map((node) => node.id));
  const presentEdgeIds = new Set(edges.map((edge) => edge.id));
  const takenNames = new Set(
    existingRecipes.map((recipe) => recipe.name.trim()),
  );
  const plans: AgentRecipePlan[] = [];

  for (const row of historyRows) {
    if (!row.isActive) continue;
    const parts = (row.parts as MessagePart[] | null) ?? [];
    parts.forEach((part, partIndex) => {
      if (part.type !== "canvas_recipe") return;

      const name =
        typeof part.name === "string"
          ? part.name.trim().slice(0, MAX_RECIPE_NAME_CHARS).trimEnd()
          : "";
      if (name.length === 0) return;
      // Idempotent: an existing (or same-pass) recipe of this name is never
      // re-created — the dedupe key is conversation + name.
      if (takenNames.has(name)) return;

      const nodeKeys = resolvePresentKeys(part.nodeKeys, presentNodeIds);
      if (nodeKeys.length === 0) return;
      const edgeKeys = resolvePresentKeys(part.edgeKeys, presentEdgeIds);
      const sourceRef = asPlainRecord(part.sourceRef);

      takenNames.add(name);
      plans.push({
        provenanceKey: `${row.id}:${partIndex}`,
        name,
        nodeKeys,
        edgeKeys,
        ...(sourceRef !== undefined ? { sourceRef } : {}),
      });
    });
  }

  return plans;
}
