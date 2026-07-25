"use client";

/**
 * entity-node.tsx — EntityNode: the canvas's `entity` custom React Flow node —
 * a resolved-entity card. Surfaces an already-built backend capability
 * (`entities.byId`, packages/api-client/src/router/entities/detail.ts) on the
 * canvas so the agent can PLACE a person/organization/vessel/etc. the extractor
 * resolved from the user's own mail.
 *
 * REF-ONLY, like every sibling (circle-pack-node, email-thread-node): `node.data`
 * carries ONLY an `entityId` (+ an optional custom `label`), NEVER the fetched
 * entity payload. The name / type / aliases / identifiers / occurrence count /
 * pending-merge count all rehydrate HERE via `api.entities.byId.useQuery({ id })`
 * — the same owned-scoped procedure `/entities/[id]` reads (TENA-03: a row owned
 * by another user surfaces as NULL, identical to a missing row). This keeps the
 * schema trivially mirrorable into packages/capabilities.
 *
 * LAW 2 (docs/design/taste-references.md, brand-guide §3) lives on this card,
 * exactly as it does on email-thread-node:
 *   displayName   -> the entity's own name  (the mail's words)  -> SERIF + data-evidence
 *   aliases       -> the entity's own names (the mail's words)  -> SERIF + data-evidence
 *   identifier    -> the unified email/domain (the mail's own   -> SERIF + data-evidence
 *   values          addresses)
 *   entity type   -> polytoken's CLASSIFICATION of the thing    -> sans (a Badge)
 *   "N emails"    -> polytoken's summary count                  -> sans
 *   "N pending"   -> polytoken's summary count                  -> sans
 * `font-serif` + `data-evidence` are applied as a PAIR on the SPANS, never on a
 * row (a serif container hands its font down to a sans caption by inheritance,
 * which no className gate can see).
 *
 * Loading -> error -> not-found (null) -> success branch order mirrors
 * email-thread-node / circle-pack-node's established precedent.
 *
 * GESTURE ISOLATION: the scrollable body carries `nowheel nopan nodrag` so a
 * wheel/drag over the identifier list scrolls the list instead of panning the
 * board; the header keeps `node-drag-handle` so the card still drags by its bar
 * (mirrors circle-pack-node).
 *
 * Remove is INK, not madder (law 1): dropping the card from the board is not
 * irreversible — the underlying entity is untouched; only the placement drops.
 *
 * NOTE FOR WIRING: this file composes the shared card recipe via
 * `canvasNodeShellClass` with a LOCAL geometry constant (`ENTITY_KIND_GEOMETRY`)
 * so it typechecks independently. When the `entity` kind is added to
 * `canvas-vocabulary.ts` (CanvasNodeKind + CANVAS_NODE_KIND_GEOMETRY +
 * CANVAS_NODE_KIND_LABEL, kept in lockstep with NODE_TYPE_REGISTRY by
 * canvas-vocabulary.test.ts), swap `ENTITY_KIND_GEOMETRY` for
 * `CANVAS_NODE_KIND_GEOMETRY["entity"]` to inherit the canonical geometry.
 */

import { memo, useEffect } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import Link from "next/link";
import { AlertCircle, Box, GitMerge, Mail, X } from "lucide-react";

import { Badge } from "@polytoken/ui/badge";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { hrefFor } from "~/components/provenance-link";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { useCanvasPublish } from "./canvas-store-context";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type EntityNodeData } from "./node-data-schemas";

export type EntityNodeType = Node<EntityNodeData, "entity">;

/**
 * resolveHeaderLabel — mirrors email-thread-node's exact 3-step order: an
 * explicit `data.label` always wins -> the fetched entity's own `displayName`
 * once the query settles with a non-empty value -> the fallback literal
 * "Untitled entity" while unsettled / errored / not-found.
 */
export function resolveHeaderLabel(
  customLabel: string | undefined,
  fetchedDisplayName: string | null | undefined,
): string {
  if (customLabel !== undefined) return customLabel;
  if (fetchedDisplayName) return fetchedDisplayName;
  return "Untitled entity";
}

/** Flatten the `identifiers` JSON (unified emails/domains — a
 * Record<string, unknown>) into [key, value] display rows, dropping empties.
 * The values are the mail's own addresses (evidence); keys are polytoken's
 * field slugs (chrome). Mirrors entities-table's `formatKeyIdentifiers`. */
function identifierRows(
  identifiers: Record<string, unknown>,
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(identifiers)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as const);
}

export const EntityNode = memo(function EntityNode({
  id,
  data,
  selected,
}: NodeProps<EntityNodeType>) {
  const { deleteElements } = useReactFlow();

  const query = api.entities.byId.useQuery({ id: data.entityId });

  const entity = query.data?.entity;
  const headerLabel = resolveHeaderLabel(data.label, entity?.displayName);
  const canOpen = query.data !== undefined && query.data !== null;

  const occurrenceCount = query.data?.occurrences.length ?? 0;
  const pendingCount = query.data?.pendingSuggestions.length ?? 0;
  const aliases = entity?.aliases ?? [];
  const identifiers = entity ? identifierRows(entity.identifiers) : [];

  // Phase 73 Wave B (LCAN-03/04) — the publish port. Once the entity query
  // settles on a resolved row, publish a bounded, glanceable projection to
  // `shared.published.{id}` so an agent-wired edge (e.g. `name -> input`)
  // carries the focused entity live through the unchanged usePanelData engine.
  // A DERIVED read, never written into node.data.
  const publish = useCanvasPublish(id);
  useEffect(() => {
    if (query.data === undefined || entity === undefined) return;
    publish({
      name: entity.displayName,
      type: entity.entityTypeLabel ?? entity.entityTypeId,
      emailCount: occurrenceCount,
      pendingMergeCount: pendingCount,
      aliasCount: aliases.length,
    });
  }, [publish, query.data, entity, occurrenceCount, pendingCount, aliases.length]);

  return (
    <div
      className={`flex h-[300px] w-[320px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["entity"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — Box icon + truncating label + remove. Icon is faded chrome,
          like every other kind (entity type is shape/hue-free — law 3). */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Box className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The entity's own name — SERIF + data-evidence (the pair), on the
              span, never the row. */}
          <span
            className="truncate font-serif text-xs font-semibold text-ink"
            data-evidence
          >
            {headerLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove entity"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — scroll isolated from the board (nowheel nopan nodrag). */}
      <div className="nowheel nopan nodrag relative flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
        {query.isPending ? (
          <div role="status" aria-label="Loading entity" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t load this entity. Try again, or open it from your entities.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : query.data === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <Box className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              This entity is unavailable. It may have been merged into another or is no longer
              accessible.
            </p>
          </div>
        ) : entity ? (
          <>
            {/* Type + counts — polytoken's classification/summary, all sans. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-2xs">
                {entity.entityTypeLabel ?? entity.entityTypeId}
              </Badge>
              <span className="inline-flex items-center gap-1 text-2xs text-faded">
                <Mail className="size-3 shrink-0" aria-hidden />
                {occurrenceCount} {occurrenceCount === 1 ? "email" : "emails"}
              </span>
              {pendingCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-rule bg-shade px-1.5 py-0.5 text-2xs text-ink"
                  title={`${pendingCount} pending merge ${pendingCount === 1 ? "suggestion" : "suggestions"}`}
                >
                  <GitMerge className="size-3 shrink-0" aria-hidden />
                  {pendingCount} pending
                </span>
              ) : null}
            </div>

            {/* Identifiers — the unified emails/domains. Values are the mail's
                own addresses (SERIF + data-evidence); the slug key is chrome. */}
            {identifiers.length > 0 ? (
              <dl className="flex flex-col gap-1">
                {identifiers.map(([key, value]) => (
                  <div key={key} className="flex min-w-0 flex-col">
                    <dt className="truncate text-2xs text-faded">{key}</dt>
                    <dd
                      className="truncate font-serif text-xs text-ink tabular"
                      data-evidence
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {/* Aliases — the entity's other names (SERIF + data-evidence). */}
            {aliases.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-2xs text-faded">Also known as</span>
                <div className="flex flex-wrap gap-1">
                  {aliases.map((alias) => (
                    <span
                      key={alias}
                      className="truncate rounded-sm border border-rule bg-leaf px-1.5 py-0.5 font-serif text-2xs text-ink"
                      data-evidence
                    >
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {identifiers.length === 0 && aliases.length === 0 ? (
              <p className="text-2xs text-faded">
                No identifiers or aliases resolved for this entity yet.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Footer — Open deep-links to /entities/<id> (route computed by hrefFor,
          never trusted from data). A --hair rule, never a --rule. */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-t border-hair px-2">
        <Link
          href={canOpen ? hrefFor("entity", data.entityId) : "#"}
          aria-disabled={!canOpen}
          onClick={(event) => {
            if (!canOpen) event.preventDefault();
          }}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs text-faded transition-colors hover:bg-ink-05 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11 ${canOpen ? "" : "pointer-events-none opacity-50"}`}
        >
          Open entity →
        </Link>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
