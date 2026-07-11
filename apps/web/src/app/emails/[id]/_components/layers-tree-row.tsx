"use client";

import { ChevronDown, ChevronRight, Square } from "lucide-react";

import { contentSnippet } from "./region-label";

import type { ComponentRole } from "./region-overlay-box";

/**
 * Role-chip tint per role (09-UI-SPEC §LAYERS Panel → Role Chips).
 * Compact inline chips: `text-xs px-2 py-1 rounded-sm font-semibold`.
 */
const ROLE_CHIP: Record<NonNullable<ComponentRole>, string> = {
  entity: "bg-graph-entity/10 text-graph-entity",
  field: "bg-graph-email-component/10 text-graph-email-component",
  unrelated: "bg-graph-email/10 text-graph-email",
};

const ROLE_LABEL: Record<NonNullable<ComponentRole>, string> = {
  entity: "Entity",
  field: "Field",
  unrelated: "Unrelated",
};

/** A single row in the LAYERS tree. Mirrors the component shape the panel feeds. */
export interface LayersTreeRowComponent {
  readonly id: string;
  readonly role: ComponentRole;
  readonly entityTypeLabel: string | null;
  readonly extractionStatus: string;
  /** The amber FIELD candidate value (auto-escaped React text node — T-09-80). */
  readonly candidateValue: string | null;
  /** Property label for FIELD rows (the entity-type-field label). */
  readonly propertyLabel: string | null;
  /** Detected region text — the primary label for UNCLASSIFIED rows (B1). */
  readonly contentText: string | null;
  /** 1-based page number for the trailing badge. */
  readonly pageNumber: number;
}

interface LayersTreeRowProps {
  readonly component: LayersTreeRowComponent;
  /** Tree depth — ENTITY/UNCLASSIFIED = 0, FIELD = 1 (indented). */
  readonly kind: "entity" | "field" | "unclassified";
  readonly isSelected: boolean;
  /** ENTITY rows only: whether field children are expanded. */
  readonly isExpanded?: boolean;
  /** ENTITY rows only: toggles child visibility (D-12). */
  readonly onToggleExpand?: () => void;
  readonly onSelect: () => void;
  /** FIELD candidate rows only: inline confirm (D-16/D-17). */
  readonly onConfirm?: () => void;
  /** FIELD candidate rows only: inline deny (D-16/D-18). */
  readonly onDeny?: () => void;
}

/**
 * LayersTreeRow — one 36px tree row (D-06/D-12, 09-UI-SPEC §LAYERS Panel).
 *
 * ENTITY: chevron + violet chip + label + page badge → click selects + arms
 * active-parent. FIELD (pl-8): amber chip + property + ":" + candidate value +
 * inline ✓/✗ (confirmed rows show bg-success/10, no controls). UNCLASSIFIED:
 * dashed-square icon + muted label. Inline ✓/✗ here are TEXT-row buttons (the
 * canvas overlay gets the floating controls).
 */
export function LayersTreeRow({
  component,
  kind,
  isSelected,
  isExpanded = false,
  onToggleExpand,
  onSelect,
  onConfirm,
  onDeny,
}: LayersTreeRowProps) {
  const role = component.role;
  const isConfirmed = component.extractionStatus === "confirmed";
  const showConfirmDeny =
    kind === "field" && !isConfirmed && component.candidateValue !== null;

  const selectedClass = isSelected
    ? "bg-primary/10 border-l-2 border-primary"
    : "border-l-2 border-transparent";

  if (kind === "entity") {
    return (
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={isExpanded}
        className={`flex items-center gap-2 py-2 px-3 hover:bg-muted cursor-pointer ${selectedClass}`}
        style={{ height: 36 }}
        onClick={onSelect}
      >
        <button
          type="button"
          aria-label={isExpanded ? "Collapse fields" : "Expand fields"}
          className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
        <span
          className={`shrink-0 text-xs px-2 py-1 rounded-sm font-semibold ${ROLE_CHIP.entity}`}
        >
          {ROLE_LABEL.entity}
        </span>
        <span className="flex-1 text-sm font-semibold truncate">
          {component.entityTypeLabel ?? "Untitled entity"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          p{component.pageNumber}
        </span>
      </div>
    );
  }

  if (kind === "field") {
    return (
      <div
        role="treeitem"
        aria-selected={isSelected}
        className={`flex items-center gap-2 py-2 pl-8 pr-3 hover:bg-muted cursor-pointer ${
          isConfirmed ? "bg-success/10" : ""
        } ${selectedClass}`}
        style={{ height: 36 }}
        onClick={onSelect}
      >
        <span
          className={`shrink-0 text-xs px-2 py-1 rounded-sm font-semibold ${ROLE_CHIP.field}`}
        >
          {ROLE_LABEL.field}
        </span>
        <span className="text-sm font-semibold truncate min-w-0 max-w-[140px]">
          {component.propertyLabel ?? "field"}
        </span>
        <span className="text-muted-foreground">:</span>
        <span className="flex-1 text-sm font-normal text-muted-foreground truncate">
          {component.candidateValue ?? ""}
        </span>
        {showConfirmDeny && (
          <span
            className="shrink-0 flex items-center gap-1"
            role="group"
            aria-label="Confirm or deny field value"
          >
            <button
              type="button"
              aria-label="Confirm field value"
              className="h-4 w-4 rounded-full bg-success hover:bg-success/90 active:bg-success/80 text-success-foreground flex items-center justify-center text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              onClick={(e) => {
                e.stopPropagation();
                onConfirm?.();
              }}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label="Deny field value"
              className="h-4 w-4 rounded-full bg-destructive hover:bg-destructive/90 active:bg-destructive/80 text-destructive-foreground flex items-center justify-center text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              onClick={(e) => {
                e.stopPropagation();
                onDeny?.();
              }}
            >
              ✗
            </button>
          </span>
        )}
      </div>
    );
  }

  // UNCLASSIFIED (role === null). B1: the primary label is the detected text
  // (entity-type label if one exists, else a content snippet), NOT the raw
  // extraction_status — status is demoted to a small trailing chip.
  const unclassifiedLabel =
    component.entityTypeLabel ??
    contentSnippet(component.contentText) ??
    "Unlabeled region";
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      className={`flex items-center gap-2 py-2 px-3 hover:bg-muted cursor-pointer ${selectedClass}`}
      style={{ height: 36 }}
      onClick={onSelect}
    >
      <Square
        className="h-3 w-3 text-muted-foreground/60 shrink-0"
        aria-hidden="true"
      />
      <span className="flex-1 text-sm text-foreground truncate">
        {unclassifiedLabel}
      </span>
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
        {component.extractionStatus}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        p{component.pageNumber}
      </span>
    </div>
  );
}
