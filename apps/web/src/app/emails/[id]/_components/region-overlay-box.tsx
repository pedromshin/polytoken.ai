"use client";

// Explicit React import (not just named hook imports) — this file's JSX
// compiles fine under Next.js's SWC automatic JSX runtime, but vitest's
// plain esbuild transform defaults to the classic runtime
// (React.createElement) and needs `React` in scope whenever a test mounts
// this component directly (mirrors genui-panel-node.tsx's identical note —
// found live, 53-03-PLAN.md Task 1, inbox-mobile-stack.test.tsx; this file
// needed it starting with 60-04-PLAN.md Task 3's region-overlay-law.test.tsx,
// the first test to mount RegionOverlayBox directly).
import * as React from "react";

import { polygonToRect } from "@polytoken/api-client/geometry";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@polytoken/ui/tooltip";

import { ConfirmDenyControls } from "./confirm-deny-controls";
import { REGION_ROLE_GEOMETRY, REGION_TIER, regionLabelFor, tierOf } from "./region-vocabulary";

interface ComponentLocation {
  page_index?: number;
  polygon?: ReadonlyArray<readonly [number, number]>;
  type: string;
}

/** Region relationship role (D-01/D-10). null = unclassified/standalone. */
export type ComponentRole = "entity" | "field" | "unrelated" | null;

interface RegionComponent {
  id: string;
  attachmentId: string | null;
  sourceType: string;
  contentText: string | null;
  extractionStatus: string;
  location: unknown;
  entityTypeLabel: string | null;
  entityTypeSlug: string | null;
  extractedFields: unknown;
  confidenceScore: unknown;
  /** Phase 9 (D-10): relationship role, drives role-geometry rendering. Optional for back-compat. */
  role?: ComponentRole;
}

interface PageSize {
  width: number;
  height: number;
}

interface RegionOverlayBoxProps {
  component: RegionComponent;
  pageSize: PageSize;
  activeComponentId: string | null;
  setActiveComponentId: (id: string | null) => void;
  onSelectComponent?: (id: string) => void;
  onShiftClick?: (id: string) => void;
  isSelected?: boolean;
  isMutating?: boolean;
  /** Phase 9 (D-10): when true, draws the active-parent ENTITY ring — ink under law 1, never a hue. */
  isActiveParent?: boolean;
  /** Phase 9 (D-16): when true, renders the inline confirm/deny slot at the box corner. */
  showConfirmDeny?: boolean;
  /**
   * Phase 9 (D-18/WR-05): whether this box was auto-detected by autofill. Drives
   * the canonical ConfirmDenyControls' origin-aware undo affordance (auto-detected
   * deny → Undo toast; user-drawn deny → no toast, geometry kept).
   */
  isAutoDetected?: boolean;
  /** Confirm callback for the inline confirm control (D-16/D-17). */
  onConfirm?: (id: string) => void;
  /** Deny callback for the inline deny control (D-16/D-18). */
  onDeny?: (id: string) => void;
  /** Restore callback for the inline Undo (auto-detected deny, WR-01). */
  onRestore?: (id: string) => void;
}

function getPolygon(
  location: unknown,
): ReadonlyArray<readonly [number, number]> | null {
  if (
    location !== null &&
    typeof location === "object" &&
    "polygon" in location &&
    Array.isArray((location as ComponentLocation).polygon) &&
    // Guard: empty array bypasses the overlay-layer hasPolygon check and
    // would produce Infinity CSS values via polygonToRect (T-60-07/CR-02).
    ((location as ComponentLocation).polygon?.length ?? 0) > 0
  ) {
    return (location as ComponentLocation).polygon ?? null;
  }
  return null;
}

function buildTooltipContent(
  entityTypeLabel: string | null,
  extractionStatus: string,
  extractedFields: unknown,
): string {
  const label = entityTypeLabel ?? extractionStatus;
  if (
    extractedFields !== null &&
    typeof extractedFields === "object" &&
    !Array.isArray(extractedFields)
  ) {
    const fields = extractedFields as Record<string, unknown>;
    const entries = Object.entries(fields);
    if (entries.length > 0) {
      const lines = entries.map(([k, v]) => `${k}: ${String(v)}`).join("\n");
      return `${label}\n${lines}`;
    }
  }
  return `${label}\nAwaiting extraction`;
}

/**
 * RegionOverlayBox (60-04-PLAN.md Task 2) — the OCR polygon as the
 * provenance mark it always was. Colour states the TIER and nothing else;
 * ROLE is carried structurally (`region-vocabulary.ts`'s
 * `REGION_ROLE_GEOMETRY`).
 *
 * COMPOSITION RULE (the inversion this plan fixes): tier and role ALWAYS
 * compose. The pre-60-04 box did `roleClass ?? statusClasses` — a role,
 * when set, REPLACED the tier treatment entirely, so the moment a region
 * got classified it stopped showing whether a human confirmed it. Every
 * box now carries both tier colour AND role geometry, always.
 *
 * T-60-02 (Tampering/XSS): every class below is selected by LOOKUP from
 * `region-vocabulary.ts`'s closed maps — never built by concatenating
 * anything derived from `component` (attacker-influenced `contentText`/
 * `entityTypeLabel`). Those render as React text nodes only.
 */
export function RegionOverlayBox({
  component,
  pageSize,
  activeComponentId,
  setActiveComponentId,
  onSelectComponent,
  onShiftClick,
  isSelected = false,
  isMutating = false,
  isActiveParent = false,
  showConfirmDeny = false,
  isAutoDetected = false,
  onConfirm,
  onDeny,
  onRestore,
}: RegionOverlayBoxProps) {
  const polygon = getPolygon(component.location);

  // Guard: only render when polygon is present
  if (!polygon) return null;

  const rect = polygonToRect(polygon);

  const isActive = component.id === activeComponentId;

  const tier = tierOf(component.extractionStatus);
  const role = component.role ?? null;
  const tierClasses = REGION_TIER[tier];
  const roleGeometry = REGION_ROLE_GEOMETRY[role ?? "none"];

  // Tier supplies colour + solid/dashed; role supplies weight/style/
  // opacity. They ALWAYS compose — see the doc comment above.
  const baseClass = `${tierClasses.box} ${roleGeometry}`;

  // Hover + active (hover-tracked) are ink-only under law 1 — for EVERY
  // role, not just the unclassified one. The pre-60-04 `role === null`
  // guard existed solely because role hues took over the visual channel;
  // with role no longer holding a hue, the guard is obsolete.
  const hoverClass = " hover:border-ink";
  const activeClasses = isActive ? " ring-2 ring-ink/40" : "";

  // Selected ring — tier's ring value (always ring-ink under law 1), never
  // a role hue.
  const selectedClass = isSelected ? ` ring-2 ${tierClasses.ring}` : "";

  // Active-parent ENTITY box: a quieter ink glow, still the outer ring, no hue.
  const activeParentClass = isActiveParent ? " ring-4 ring-ink/20" : "";

  const mutatingClass = isMutating ? " animate-pulse opacity-70" : "";

  const tooltipText = buildTooltipContent(
    component.entityTypeLabel,
    component.extractionStatus,
    component.extractedFields,
  );

  // The label chip is where the signature lands — the same mark language
  // as the inbox chip ("one mark language everywhere"). Colour comes ONLY
  // from tier; the chip is serif ONLY when it carries the document's own
  // words (law 2, no exceptions).
  const label = regionLabelFor(component);
  const labelFontClass = label.kind === "text" ? " font-serif" : "";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            style={{
              position: "absolute",
              left: rect.left * pageSize.width,
              top: rect.top * pageSize.height,
              width: rect.width * pageSize.width,
              height: rect.height * pageSize.height,
            }}
            className={`pointer-events-auto ${baseClass} rounded-sm${hoverClass} transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none cursor-pointer${activeClasses}${selectedClass}${activeParentClass}${mutatingClass}`}
            role="region"
            aria-label={`${role ? `${role}: ` : ""}${label.text} region`}
            aria-pressed={isSelected}
            aria-busy={isMutating}
            tabIndex={0}
            data-component-id={component.id}
            data-role={role ?? undefined}
            data-tier={tier}
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) {
                onShiftClick?.(component.id);
              } else {
                onSelectComponent?.(component.id);
              }
            }}
            onMouseEnter={() => setActiveComponentId(component.id)}
            onMouseLeave={() => setActiveComponentId(null)}
            onFocus={() => setActiveComponentId(component.id)}
            onBlur={() => setActiveComponentId(null)}
          >
            {/* Label chip — pointer-events-none so the box stays interactive. */}
            <span
              data-evidence={label.kind === "text" ? true : undefined}
              className={`absolute -top-5 left-0 text-2xs font-semibold ${tierClasses.chip}${labelFontClass} px-2 py-0.5 rounded-sm whitespace-nowrap max-w-[160px] truncate pointer-events-none`}
            >
              {label.text}
            </span>

            {/* Inline confirm/deny slot (D-16/D-17/D-18). Converged on the
                canonical ConfirmDenyControls (WR-01) — origin-aware deny +
                undo. Only rendered on candidate FIELD boxes via
                showConfirmDeny. */}
            {showConfirmDeny && onConfirm && onDeny && (
              <ConfirmDenyControls
                componentId={component.id}
                isAutoDetected={isAutoDetected}
                onConfirm={onConfirm}
                onDeny={onDeny}
                onRestore={onRestore}
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="whitespace-pre-line">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
