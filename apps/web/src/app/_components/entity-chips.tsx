"use client";

import Link from "next/link";

import { Badge } from "@polytoken/ui/badge";

/** One distinct extracted entity type for an email (from emails.entitySummary). */
export interface EntityChipEntry {
  readonly entityTypeId: string;
  readonly label: string;
  readonly count: number;
  /**
   * D-24: entity instance id resolved from a wasSelected=true candidate link.
   * When present, the chip deep-links to /entities/{entityInstanceId}.
   * When absent, falls back to /emails/{emailId}.
   */
  readonly entityInstanceId?: string;
}

interface EntityChipsProps {
  readonly entities: ReadonlyArray<EntityChipEntry>;
  readonly emailId: string;
}

// D-23 anti-bloat: surface at most this many distinct entity types per row; the
// remainder collapse into a single "+N" overflow chip.
const MAX_VISIBLE_CHIPS = 4;

/**
 * EntityChips (D-23/D-24) — translucent per-entity-type badges for an inbox row.
 *
 * Each chip shows the entity-type label, suffixed with `·count` when more than
 * one of that type was extracted. Chips render on `color.graph.entity` (the
 * entity-family tint from the canvas role-color palette, no second accent
 * hue) and `radius.pill`.
 *
 * D-24: When entityInstanceId is present the chip deep-links to
 * /entities/{entityInstanceId}. Otherwise falls back to /emails/{emailId}.
 *
 * Empty `entities` renders nothing (anti-bloat — no empty container, no label).
 */
export function EntityChips({
  entities,
  emailId,
}: EntityChipsProps): React.ReactElement | null {
  if (entities.length === 0) return null;

  const visible = entities.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = entities.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((entity) => {
        const href =
          entity.entityInstanceId !== undefined
            ? `/entities/${entity.entityInstanceId}`
            : `/emails/${emailId}`;

        return (
          <Link
            key={entity.entityTypeId}
            href={href}
            className="rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            // The chip is independent of row selection; stop the click from also
            // toggling the row's reading-preview selection.
            onClick={(event) => event.stopPropagation()}
          >
            <Badge
              variant="outline"
              className="gap-1 rounded-pill border-graph-entity/30 bg-graph-entity/10 text-graph-entity hover:bg-accent hover:text-accent-foreground"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-graph-entity"
              />
              <span className="truncate">{entity.label}</span>
              {entity.count > 1 && (
                <span className="text-graph-entity">·{entity.count}</span>
              )}
            </Badge>
          </Link>
        );
      })}

      {overflowCount > 0 && (
        <Badge
          variant="outline"
          className="rounded-pill border-graph-entity/30 bg-graph-entity/10 text-graph-entity"
        >
          +{overflowCount}
        </Badge>
      )}
    </div>
  );
}
