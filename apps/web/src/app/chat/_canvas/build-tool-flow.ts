/**
 * build-tool-flow.ts — the pure core of the "Build a tool from these" summon
 * loop (Phase 76 / 76-04). This is the gesture that finally makes the
 * code-island node USER-REACHABLE: multi-select ≥2 data nodes on the canvas,
 * and this assembles what the generator + the persistence layer need to mint one
 * bespoke tool grounded in those exact sources.
 *
 * It is deliberately pure (no React, no store, no network) so the manifest /
 * binding assembly — the part with real logic — is unit-testable in jsdom; the
 * async generate → create → materialize orchestration lives in chat-canvas.tsx.
 *
 * TWO parallel records come out of one collection pass, keyed by the SAME
 * targetKey per source, and the distinction is the whole security posture of the
 * phase:
 *   - `inputs` (the SHAPE manifest) goes to the GENERATOR (the model): each
 *     source's label, node type, and top-level field names/types — never a
 *     single row VALUE. The model writes code against the structure blind to the
 *     data.
 *   - `inputBindings` (the WIRING) is persisted on the code_islands row and
 *     mirrors the canvas data-edges: `targetKey -> { sourceNodeKey, sourcePath }`
 *     pointing at `shared.published.{nodeId}`. At runtime the VALUES flow through
 *     those edges into the sandbox's `window.__ISLAND_DATA__.{targetKey}` — never
 *     through the model.
 *
 * Only nodes that have actually PUBLISHED a projection to
 * `shared.published.{nodeId}` (Phase 73 Wave B publish port) are eligible — a
 * selected node whose query hasn't settled, or a type that doesn't publish, is
 * silently skipped; the caller enforces the ≥2 floor.
 */

import type { Node as FlowNode } from "@xyflow/react";

import { publishedNodePath } from "./canvas-publish";
import { CHAT_NODE_TYPE } from "./canvas-selection";
import { resolveCanvasPath } from "./canvas-store";

/** A code-island can't consume another code-island (no published projection to
 * read, and a tool-of-tools is out of scope for the summon loop). Excluded up
 * front alongside the protected chat singleton. */
const INELIGIBLE_SOURCE_TYPES = new Set([CHAT_NODE_TYPE, "code-island"]);

/** Manifest keys and injected-data property names must never be pollution
 * vectors (mirrors canvas-publish + the codeIslands router bindings guard). */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** How many top-level fields of a source's projection the shape manifest
 * describes. Bounded — the manifest is a glance at structure, not a dump; the
 * api-client schema caps at 50 regardless. */
const MAX_MANIFEST_FIELDS = 24;

/** One wired source's shape descriptor sent to the generator (SHAPE only).
 * Arrays are intentionally mutable so this is structurally assignable to the
 * api-client `codeIslandGenerate` input (a zod-inferred mutable manifest). */
export interface ToolInputManifestEntry {
  label?: string;
  nodeType?: string;
  fields?: Array<{ name: string; type?: string }>;
  rowCount?: number;
}

/** One persisted binding: which published path feeds this island's targetKey. */
export interface ToolInputBinding {
  readonly sourceNodeKey: string;
  readonly sourcePath: string;
}

/** One resolved source in the collection — enough for the caller to draw the
 * data-edge (nodeId → island, at targetKey) after the island is created. */
export interface CollectedToolSource {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly targetKey: string;
}

export interface CollectedTool {
  readonly sources: readonly CollectedToolSource[];
  readonly inputs: Record<string, ToolInputManifestEntry>;
  readonly inputBindings: Record<string, ToolInputBinding>;
  readonly intent: string;
}

/**
 * toTargetKey — turn a node type into a stable JS-identifier-ish key the island
 * reads as `window.__ISLAND_DATA__.{key}`, disambiguating collisions (two
 * `usage` sources → `usage`, `usage_2`). Non-word chars collapse to `_`; a key
 * that doesn't start with a letter is prefixed so it's a valid identifier; a
 * forbidden key is neutralized.
 */
export function toTargetKey(nodeType: string, used: ReadonlySet<string>): string {
  let base = nodeType.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (base.length === 0 || !/^[A-Za-z]/.test(base)) base = `src_${base}`;
  base = base.replace(/_+$/g, "");
  if (FORBIDDEN_KEYS.has(base)) base = `src_${base}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** coarse JSON type of a projection field, for the shape manifest. */
function coarseType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * describeSourceShape — a SHAPE-only descriptor of a source's published
 * projection for the generator. Reads the projection's own top-level keys
 * (bounded) as fields + their coarse types; lifts a `label` and a numeric
 * `rowCount` when present. Never copies a data value into the manifest.
 */
export function describeSourceShape(
  nodeType: string,
  projection: unknown,
): ToolInputManifestEntry {
  const entry: {
    label?: string;
    nodeType?: string;
    fields?: Array<{ name: string; type?: string }>;
    rowCount?: number;
  } = { nodeType };

  if (
    projection !== null &&
    typeof projection === "object" &&
    !Array.isArray(projection)
  ) {
    const obj = projection as Record<string, unknown>;
    const rawLabel = obj["label"];
    if (typeof rawLabel === "string" && rawLabel.length > 0) {
      entry.label = rawLabel.slice(0, 200);
    }
    const rawRowCount = obj["rowCount"];
    if (typeof rawRowCount === "number" && Number.isFinite(rawRowCount)) {
      entry.rowCount = rawRowCount;
    }
    const fields: Array<{ name: string; type?: string }> = [];
    for (const [key, value] of Object.entries(obj)) {
      if (fields.length >= MAX_MANIFEST_FIELDS) break;
      if (FORBIDDEN_KEYS.has(key)) continue;
      fields.push({ name: key, type: coarseType(value) });
    }
    if (fields.length > 0) entry.fields = fields;
  }

  return entry;
}

/** A readable default label for a source (its projection label → its type). */
function sourceLabel(nodeType: string, projection: unknown): string {
  if (projection !== null && typeof projection === "object" && !Array.isArray(projection)) {
    const raw = (projection as Record<string, unknown>)["label"];
    if (typeof raw === "string" && raw.length > 0) return raw;
  }
  return nodeType;
}

/**
 * buildToolIntent — the default generation prompt when the user hasn't typed
 * one: a plain-language ask to combine the wired sources into one small tool.
 * The generator also receives the structured `inputs` manifest; this is the
 * human framing.
 */
export function buildToolIntent(labels: readonly string[]): string {
  const list = labels.slice(0, 8).join(", ");
  return (
    `Build a small, self-contained tool that combines these data sources: ${list}. ` +
    `Read each source from window.__ISLAND_DATA__ by its key and render a single, ` +
    `useful view over them.`
  );
}

/**
 * collectToolInputs — the collection pass. From the currently-selected nodes and
 * the live canvas store `values`, keep the eligible sources that have published
 * a projection, assign each a unique targetKey, and assemble the parallel
 * `inputs` (shape → generator) + `inputBindings` (wiring → persistence) records
 * plus a default `intent`. Pure: never touches the store or the network.
 *
 * The caller enforces the ≥2 floor and surfaces the "select more" hint; this
 * returns however many were eligible (possibly 0/1).
 */
export function collectToolInputs(
  selected: readonly FlowNode[],
  values: Record<string, unknown>,
): CollectedTool {
  const sources: CollectedToolSource[] = [];
  const inputs: Record<string, ToolInputManifestEntry> = {};
  const inputBindings: Record<string, ToolInputBinding> = {};
  const labels: string[] = [];
  const used = new Set<string>();

  for (const node of selected) {
    const nodeType = node.type ?? "unknown";
    if (INELIGIBLE_SOURCE_TYPES.has(nodeType)) continue;

    const sourcePath = publishedNodePath(node.id);
    const projection = resolveCanvasPath(values, sourcePath);
    if (projection === undefined || projection === null) continue;

    const targetKey = toTargetKey(nodeType, used);
    used.add(targetKey);

    sources.push({ nodeId: node.id, nodeType, targetKey });
    inputs[targetKey] = describeSourceShape(nodeType, projection);
    inputBindings[targetKey] = { sourceNodeKey: node.id, sourcePath };
    labels.push(sourceLabel(nodeType, projection));
  }

  return { sources, inputs, inputBindings, intent: buildToolIntent(labels) };
}
