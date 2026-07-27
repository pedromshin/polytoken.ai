/**
 * agent-code-island-reconcile.ts — the PURE client half of the agent-authored
 * code-island seam (Phase 76-05 / BTAP-07, SPEC seam 5). Stream D landed the
 * listener `emit_code_island` tool that, behind `CANVAS_EMIT_TOOL_ENABLED`,
 * finalizes into a persisted `canvas_code_island` message part of the frozen
 * shape `{ type, intent, inputs, inputBindings, selectedNodeKeys }`
 * (run_chat_turn_tool_loop.py `_build_canvas_code_island_part`). This module is
 * the counterpart of `collectAgentEdges` / `buildExpectedAgentNodeSpecs`
 * (LCAN-01, use-canvas-persistence.ts): it turns that part into a materializable
 * plan the canvas reconcile effect runs.
 *
 * The grounding flow is the SAME one the user-driven "Build a tool from these"
 * summon runs (build-tool-flow.ts `collectToolInputs`): the model's part names
 * WHICH nodes and WHAT to build, but the client re-grounds against ITS OWN live
 * canvas — it resolves each `selectedNodeKey` to a present node and reads that
 * node's `shared.published.{nodeKey}` projection (never the model's claimed
 * shape) to assemble the manifest + bindings. So an agent can only wire an app
 * to sources that are actually on the user's canvas and have published — the
 * VALUES still flow to the sandbox alone, never to the model.
 *
 * IDEMPOTENCY (mirrors LCAN-01): the code-island node id is DETERMINISTIC from
 * the part's provenance (`agent-island:{messageId}:{partIndex}`). Once the async
 * runner materializes + saves it, the post-turn `getCanvasLayout` refetch
 * restores that node by id (reconcileNodesFromHistory Pass 1) → it is present →
 * `collectAgentCodeIslandPlans` skips the part. The edges dedupe on the same
 * `agentEdgeId` tuple the LCAN connect path uses, so a re-run never double-draws.
 * The plan is PURE (no network); the async generate → codeIslands.create →
 * materialize glue lives in chat-canvas.tsx, exactly like handleBuildTool.
 */

import type { Node as FlowNode } from "@xyflow/react";

import {
  collectToolInputs,
  type CollectedToolSource,
  type ToolInputBinding,
  type ToolInputManifestEntry,
} from "./build-tool-flow";
import { EdgePayloadSchema } from "./edge-payload-schema";
import {
  agentEdgeId,
  DRAG_HANDLE_SELECTOR,
  type PersistedCanvasEdge,
} from "./use-canvas-persistence";

import type { MessagePart } from "../_hooks/use-chat-stream";
import type { ChatHistoryRow } from "../_hooks/use-conversation-controller";

/** The ≥2-source floor the summon loop enforces (handleBuildTool) — an agent
 * part is only materialized once at least this many of its selected nodes are
 * present AND have published a projection. Below it, the plan is skipped and the
 * reconcile retries on the next pass (a source whose query settles a tick later
 * still lands). Mirrors the phase's "select 2+ data nodes" gesture. */
const MIN_SOURCES = 2;

/**
 * agentCodeIslandNodeId — the DETERMINISTIC id for the code-island node an agent
 * authored via a `canvas_code_island` part, keyed on the part's provenance so
 * (a) the same part re-materializes to the SAME node on the post-turn refetch
 * (idempotent no-op — never a duplicate) and (b) it never collides with a
 * `code-island:{uuid}` node the user-driven summon mints or an `agent:{handle}`
 * node from a `canvas_add_node` part.
 */
export function agentCodeIslandNodeId(messageId: string, partIndex: number): string {
  return `agent-island:${messageId}:${partIndex}`;
}

/** A materializable plan for one `canvas_code_island` part. Everything the async
 * runner needs EXCEPT the persisted island id (which requires the network
 * create): the deterministic node id, the intent + shape manifest fed to the
 * generator, the bindings persisted on the row, and the source→island data-edges
 * (already deterministic + payload-gated, ready for toFlowEdge). */
export interface AgentCodeIslandPlan {
  readonly nodeId: string;
  /** `{messageId}:{partIndex}` — the runner's in-flight dedup key so a plan is
   * generated/created at most once per session while its create is pending. */
  readonly provenanceKey: string;
  readonly intent: string;
  readonly inputs: Record<string, ToolInputManifestEntry>;
  readonly inputBindings: Record<string, ToolInputBinding>;
  readonly sources: readonly CollectedToolSource[];
  readonly edges: readonly PersistedCanvasEdge[];
}

/** One data-edge per collected source (source node → the island), keyed on the
 * LCAN dedup tuple and gated through the SAME `EdgePayloadSchema` the connect
 * and persist paths use (no drift). Deduped by id so the same source never draws
 * twice. The sourcePath is the physical `shared.published.{nodeId}` the binding
 * recorded, so the node's unchanged usePanelData overlay carries the projection
 * into `window.__ISLAND_DATA__.{targetKey}`. */
function buildCodeIslandEdges(
  sources: readonly CollectedToolSource[],
  inputBindings: Record<string, ToolInputBinding>,
  islandNodeId: string,
): PersistedCanvasEdge[] {
  const byId = new Map<string, PersistedCanvasEdge>();
  for (const source of sources) {
    if (source.nodeId === islandNodeId) continue; // self-loop guard (id is fresh, defensive)
    const binding = inputBindings[source.targetKey];
    if (binding === undefined) continue;
    const parsed = EdgePayloadSchema.safeParse({
      sourcePath: binding.sourcePath,
      targetKey: source.targetKey,
    });
    if (!parsed.success) continue;
    const id = agentEdgeId(
      source.nodeId,
      islandNodeId,
      parsed.data.sourcePath,
      parsed.data.targetKey,
    );
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      source: source.nodeId,
      target: islandNodeId,
      data: { sourcePath: parsed.data.sourcePath, targetKey: parsed.data.targetKey },
    });
  }
  return [...byId.values()];
}

/**
 * collectAgentCodeIslandPlans — every ACTIVE turn's `canvas_code_island` part
 * that (a) has NOT already been materialized (its deterministic node id is not
 * present on the canvas) and (b) re-grounds to ≥MIN_SOURCES present, published
 * sources. Pure; never mutates its inputs and never touches the network.
 *
 * `nodes` is the CURRENT canvas node set (both the present-id idempotency check
 * and the selectedNodeKey→FlowNode resolution read it); `values` is the live
 * canvas store `values` bag (the published projections). A part referencing
 * nodes that aren't on this canvas, or sources that haven't published, simply
 * yields fewer eligible sources — below the floor it is skipped, not drawn
 * broken (fail-closed, mirroring the LCAN "both endpoints must exist" posture).
 */
export function collectAgentCodeIslandPlans(
  historyRows: readonly ChatHistoryRow[],
  nodes: readonly FlowNode[],
  values: Record<string, unknown>,
): AgentCodeIslandPlan[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const presentIds = new Set(nodes.map((node) => node.id));
  const plans: AgentCodeIslandPlan[] = [];
  const seen = new Set<string>();

  for (const row of historyRows) {
    if (!row.isActive) continue;
    const parts = (row.parts as MessagePart[] | null) ?? [];
    parts.forEach((part, partIndex) => {
      if (part.type !== "canvas_code_island") return;
      if (!Array.isArray(part.selectedNodeKeys)) return;

      const nodeId = agentCodeIslandNodeId(row.id, partIndex);
      // Idempotent: a materialized+restored (or same-pass) island is never re-planned.
      if (presentIds.has(nodeId) || seen.has(nodeId)) return;

      // Re-ground: resolve the model's selectedNodeKeys to nodes actually on
      // THIS canvas, then run the SAME collection pass the user summon uses —
      // it reads each node's published projection and skips unpublished /
      // ineligible sources.
      const selectedFlowNodes = part.selectedNodeKeys
        .map((key) => nodesById.get(key))
        .filter((node): node is FlowNode => node !== undefined);
      if (selectedFlowNodes.length === 0) return;

      const collected = collectToolInputs(selectedFlowNodes, values);
      if (collected.sources.length < MIN_SOURCES) return;

      // The agent's intent (its own words) wins; fall back to the auto intent
      // derived from the wired sources when it is missing/blank.
      const partIntent = typeof part.intent === "string" ? part.intent.trim() : "";
      const intent = partIntent.length > 0 ? partIntent : collected.intent;

      seen.add(nodeId);
      plans.push({
        nodeId,
        provenanceKey: `${row.id}:${partIndex}`,
        intent,
        inputs: collected.inputs,
        inputBindings: collected.inputBindings,
        sources: collected.sources,
        edges: buildCodeIslandEdges(collected.sources, collected.inputBindings, nodeId),
      });
    });
  }

  return plans;
}

/**
 * buildAgentCodeIslandNode — the code-island FlowNode for a materialized plan.
 * Ref-only `data = { islandId }` (the row rehydrates code + bindings via
 * codeIslands.byId — the node never carries the generated code), the
 * deterministic id from the plan, and the header-only drag handle every canvas
 * node uses. Pure. `position` is supplied by the caller (a viewport-centered,
 * cascade-cleared placement, exactly like handleBuildTool's).
 */
export function buildAgentCodeIslandNode(
  plan: AgentCodeIslandPlan,
  islandId: string,
  position: { readonly x: number; readonly y: number },
): FlowNode {
  return {
    id: plan.nodeId,
    type: "code-island",
    position: { x: position.x, y: position.y },
    dragHandle: DRAG_HANDLE_SELECTOR,
    data: { islandId },
  };
}
