"use client";

// Explicit React import — this file's JSX compiles fine under Next.js's SWC
// automatic JSX runtime, but vitest's plain esbuild transform defaults to
// the classic runtime (React.createElement) and needs `React` in scope
// whenever a test mounts this component (mirrors genui-panel-node.tsx's
// identical note — found live, 53-03-PLAN.md Task 1,
// inbox-mobile-stack.test.tsx).
import * as React from "react";
import Link from "next/link";

/**
 * One extracted FACT for an email (from emails.entitySummary), post-60-01
 * Task 2's per-fact rewrite. This REPLACES the pre-60 distinct-entity-TYPE
 * rollup shape (`{ entityTypeId, label, count }`) — every surviving
 * component is now its own chip, not a type-count badge.
 */
export interface EntityChipEntry {
  readonly componentId: string;
  readonly entityTypeId: string;
  readonly typeLabel: string;
  readonly value: string | null;
  readonly tier: "confirmed" | "suggested";
  /**
   * D-24: entity instance id resolved from a wasSelected=true candidate link.
   * When present, the chip deep-links to /entities/{entityInstanceId}.
   * When absent, falls back to /emails/{emailId}.
   */
  readonly entityInstanceId?: string;
}

interface EntityChipsProps {
  readonly entities: ReadonlyArray<EntityChipEntry>;
  /**
   * The server's TRUE pre-cap fact count for this email
   * (`EmailEntitySummary.totalCount`, T-60-03). The overflow chip is derived
   * from `totalCount - visible.length` rather than `entities.length -
   * visible.length` so it counts facts the server withheld too, not just
   * ones this row hid.
   */
  readonly totalCount: number;
  readonly emailId: string;
}

// D-23 anti-bloat: surface at most this many chips per row; the remainder
// collapse into a single neutral "+N" overflow chip.
export const MAX_VISIBLE_CHIPS = 4;

/**
 * EntityChips (D-23/D-24, D-58-01) — the provenance mark on every extracted
 * fact shown in an inbox row.
 *
 * 60-01 Task 3 rewrite: this used to be a type-rollup badge tinted with an
 * entity-TYPE role colour (the canvas "graph" role palette's entity swatch)
 * — a hue spent on classification, which law 1 forbids ("colour is earned";
 * a hue means exactly one thing). Each chip now renders the extracted VALUE first (the
 * user's own material, serif) with a subordinate `· {typeLabel}` qualifier
 * (product-generated chrome, sans), coloured ONLY by confidence tier via the
 * `pmark`/`pmark-confirmed`/`pmark-suggested` provenance-mark utilities
 * (59-02) — solid border = confirmed, dashed border = suggested. No entity
 * TYPE hue anywhere. No `tshape` glyph either (deliberate: the type WORD is
 * already present beside it — the sketch's own "Chanel rule" removed the
 * shape from exactly this surface for the same reason).
 *
 * Deep-links, click-propagation stopping, and the render-nothing-when-empty
 * behaviour are all preserved from the pre-60 chip.
 *
 * Empty `entities` renders nothing (anti-bloat — no empty container, no label).
 */
export function EntityChips({
  entities,
  totalCount,
  emailId,
}: EntityChipsProps): React.ReactElement | null {
  if (entities.length === 0) return null;

  const visible = entities.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = totalCount - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((entity) => {
        const href =
          entity.entityInstanceId !== undefined
            ? `/entities/${entity.entityInstanceId}`
            : `/emails/${emailId}`;
        const tierClass = entity.tier === "confirmed" ? "pmark-confirmed" : "pmark-suggested";
        const primaryText = entity.value ?? entity.typeLabel;

        return (
          <Link
            key={entity.componentId}
            href={href}
            data-field="chip"
            data-tier={entity.tier}
            title={`${primaryText} · ${entity.typeLabel}`}
            // pmark supplies geometry (radius, base padding) + font-serif by
            // default; font-sans here overrides that default so the
            // subordinate type qualifier (a sans span nested below) does not
            // inherit serif from its ancestor — law 2 ("chrome speaks sans")
            // applies to the product-generated TYPE word, not just the
            // user's own extracted VALUE. pmark-confirmed/pmark-suggested
            // supply the whole tier language (wash, border, text colour) —
            // never re-hand-rolled here.
            className={`pmark ${tierClass} inline-flex max-w-full items-baseline gap-1 rounded-sm px-chip-x py-chip-y font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1`}
            // The chip is independent of row selection; stop the click from
            // also toggling the row's reading-preview selection.
            onClick={(event) => event.stopPropagation()}
          >
            <span className="truncate font-serif tabular">{primaryText}</span>
            <span className="shrink-0 text-2xs opacity-75">· {entity.typeLabel}</span>
          </Link>
        );
      })}

      {overflowCount > 0 && (
        // Chrome, not a fact — no tier hue, no data-tier (Plan 02's gate
        // requires every [data-field="chip"] to carry a valid tier, so this
        // is deliberately marked "chip-overflow", not "chip").
        <span
          data-field="chip-overflow"
          className="inline-flex items-center rounded-sm border border-rule bg-bright px-chip-x py-chip-y text-2xs text-faded"
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
}
