"use client";

/**
 * recipe-overlay.tsx — the on-canvas recipe badge (Phase 73 Wave C, LCAN-07).
 *
 * A `canvas_recipes` row names a wired dataflow: a `name` over a set of member
 * node keys (`nodeKeys`, canonical `type:ref` ids — see
 * `packages/db/src/canvas-repository.ts:142` `canonicalNodeId`, which the client
 * FlowNode `id` mirrors). This overlay reads `api.canvasRecipes.list` for the
 * open conversation and, for every recipe whose members are ON the canvas,
 * draws a fieldset-style legend: a light neutral outline enclosing the member
 * group with the recipe's name straddling its top edge.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE BADGE IS NEUTRAL CHROME — the same law `data-edge.tsx` pins on the wire
 * ────────────────────────────────────────────────────────────────────────
 *
 * A recipe GROUPS wired nodes; grouping is structure, not provenance, and it
 * confirms nothing about whether the wiring is right or the data is true. Law 1
 * (colour is earned) therefore gives this surface NO hue: the outline is
 * `border-rule`, the pill is `bg-bright` + `border-rule` + `text-ink`, and there
 * is zero shadow (58-IDENTITY: "flat surfaces, hairline rules, zero shadow").
 * Someone will want to tint a "live" recipe — a data/recipe wire confirms
 * nothing, exactly as `data-edge.tsx:14` argues for the wire. Do not.
 *
 * The name is polytoken/user CHROME naming a construct (like
 * `CANVAS_NODE_KIND_LABEL`), NOT the document's own words, so law 2 gives it the
 * SANS — never `font-serif`/`data-evidence`, never `pmark`/`chip` (which would
 * inherit serif onto chrome where no class-reading gate can see it).
 *
 * ────────────────────────────────────────────────────────────────────────
 * COORDINATE SPACE — why `ViewportPortal`
 * ────────────────────────────────────────────────────────────────────────
 *
 * `ViewportPortal` renders children into React Flow's transformed viewport pane,
 * so a child positioned at FLOW coordinates pans and zooms in lockstep with the
 * nodes it encloses — no manual transform math, no re-render on every viewport
 * change. The whole overlay is `pointer-events: none`; it never intercepts a
 * drag, marquee, or pane click.
 *
 * Additive: this component only READS `canvas_recipes`; it never touches
 * `nodes`/`edges` or the persisted layout. With no recipes (the default) the
 * `list` query returns `[]` and this renders nothing at all.
 */

import * as React from "react";
import { ViewportPortal, type Node as FlowNode } from "@xyflow/react";

import { api } from "~/trpc/react";

import {
  CANVAS_NODE_DIMENSIONS,
  DEFAULT_CANVAS_NODE_DIMENSIONS,
} from "./canvas-layout";

/** The slice of a `canvasRecipes.list` row this overlay needs. Kept structural
 * (not a router-type import) so the geometry helper stays trivially testable. */
export interface RecipeLike {
  readonly id: string;
  readonly name: string;
  readonly nodeKeys: readonly string[];
}

/** A placed, ready-to-render recipe legend in FLOW coordinates. */
export interface RecipeGroup {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly memberCount: number;
}

/** Padding (flow px) between a member group's tight bounding box and the drawn
 * legend outline, so the rule never clips the enclosed node shells. */
const GROUP_PADDING = 14;

/** The rendered rect of a FlowNode in flow coordinates. Prefers React Flow's
 * MEASURED size when present (post-mount), falling back to the fixed per-type
 * dimensions the dagre layout also ranks against. */
function nodeRect(node: FlowNode): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const measuredW =
    typeof node.measured?.width === "number" ? node.measured.width : undefined;
  const measuredH =
    typeof node.measured?.height === "number" ? node.measured.height : undefined;
  const widthProp = typeof node.width === "number" ? node.width : undefined;
  const heightProp = typeof node.height === "number" ? node.height : undefined;
  const dims =
    CANVAS_NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_CANVAS_NODE_DIMENSIONS;
  return {
    x: node.position.x,
    y: node.position.y,
    w: measuredW ?? widthProp ?? dims.width,
    h: measuredH ?? heightProp ?? dims.height,
  };
}

/**
 * computeRecipeGroups — PURE. For each recipe, gather the FlowNodes whose `id`
 * is one of the recipe's `nodeKeys` and compute the padded bounding box over
 * them. A recipe with NO member on the canvas is omitted entirely (nothing to
 * group) — the caller renders exactly the returned groups, so an empty result
 * renders nothing.
 */
export function computeRecipeGroups(
  recipes: readonly RecipeLike[],
  nodes: readonly FlowNode[],
): RecipeGroup[] {
  const byId = new Map<string, FlowNode>();
  for (const node of nodes) byId.set(node.id, node);

  const groups: RecipeGroup[] = [];
  for (const recipe of recipes) {
    const members: FlowNode[] = [];
    for (const key of recipe.nodeKeys) {
      const node = byId.get(key);
      if (node) members.push(node);
    }
    if (members.length === 0) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of members) {
      const r = nodeRect(node);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }

    groups.push({
      id: recipe.id,
      name: recipe.name,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2,
      memberCount: members.length,
    });
  }
  return groups;
}

/** One recipe legend: a neutral outline enclosing the member group with the
 * name pill straddling its top edge. Presentational + pure; positioned by the
 * caller inside the viewport pane. */
export function RecipeGroupBadge({
  group,
}: {
  readonly group: RecipeGroup;
}): React.ReactElement {
  return (
    <div
      data-recipe-id={group.id}
      role="presentation"
      className="pointer-events-none absolute rounded-card border border-rule"
      style={{
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
      }}
    >
      {/* Fieldset-style legend: the pill straddles the top rule (translate-y
          -1/2), its `bg-bright` fill covering the rule behind it. Neutral
          chrome, sans, zero shadow. */}
      <span className="absolute left-3 top-0 inline-flex max-w-[calc(100%-1.5rem)] -translate-y-1/2 items-center truncate rounded-sm border border-rule bg-bright px-chip-x py-px text-2xs text-ink">
        {group.name}
      </span>
    </div>
  );
}

/**
 * RecipeOverlay — mounted once inside `ReactFlow` (so `ViewportPortal` has the
 * store context). Reads the conversation's recipes and draws a legend for each
 * one that has members on the canvas. Renders nothing when there are none.
 */
export function RecipeOverlay({
  conversationId,
  nodes,
}: {
  readonly conversationId: string;
  readonly nodes: readonly FlowNode[];
}): React.ReactElement | null {
  const { data } = api.canvasRecipes.list.useQuery({ conversationId });

  const groups = React.useMemo(() => {
    // `nodeKeys` is a jsonb column (typed `unknown` at the tRPC boundary) — narrow
    // it to a string[] before the pure geometry helper, dropping any non-string
    // entry defensively. Identity/ownership is enforced server-side; this is a
    // shape guard, not a trust boundary.
    const recipes: RecipeLike[] = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      nodeKeys: Array.isArray(row.nodeKeys)
        ? row.nodeKeys.filter((k): k is string => typeof k === "string")
        : [],
    }));
    return computeRecipeGroups(recipes, nodes);
  }, [data, nodes]);

  if (groups.length === 0) return null;

  return (
    <ViewportPortal>
      {groups.map((group) => (
        <RecipeGroupBadge key={group.id} group={group} />
      ))}
    </ViewportPortal>
  );
}
