"use client";

/**
 * edge-detail-popover.tsx — suggestion-edge detail surface + Promote button
 * (Phase-30 TIER-03 closure), on the LOCKED identity (Phase 62 / SURF-03).
 *
 * The tier badge is the one element here that has EARNED a hue (law 1): a
 * suggested connection wears the pencil-amber family, dashed — the same mark
 * language as every chip and edge in the app. "Uncertain" (AMBIGUOUS) is the
 * same claim at lower confidence: the amber fades, it never changes family.
 * Reviewer-facing words only — never the raw enum names.
 *
 * Scope discipline (hard ceiling): ONE popover, ONE button, error toast on
 * 4xx — no review queue, no bulk operations, no dismiss/deactivate action.
 * Promote is a positive, confirmable action: an ink-filled button, not
 * madder (nothing here is irreversible-destructive).
 *
 * SECURITY (T-11-05): every DB-origin string (relationType,
 * provenanceSummary) renders as plain escaped React text — no
 * dangerouslySetInnerHTML anywhere in this file.
 *
 * No font-medium (500) — only font-normal (400) or font-semibold (600).
 */

import { Check, Loader2 } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@polytoken/ui/popover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PopoverEdge {
  readonly id: string;
  readonly relationType: string;
  readonly tier: "INFERRED" | "AMBIGUOUS";
  readonly confidence?: number;
  readonly provenanceSummary?: string;
}

export interface AnchorPoint {
  readonly x: number;
  readonly y: number;
}

interface EdgeDetailPopoverProps {
  readonly edge: PopoverEdge | null;
  readonly anchorPosition: AnchorPoint | null;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPromote: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-2xs font-semibold tracking-[0.05em] text-pencil uppercase">
        {label}
      </span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * The tier stated in CHROME — a sans badge in the suggested family (earned:
 * this IS a tier claim). Dashed border = suggested, the signature mark
 * language; AMBIGUOUS is the same family at reduced presence, exactly like
 * its edge. Never `pmark` here — pmark implies serif, and these are
 * polytoken's words, not the document's.
 */
function TierBadge({
  tier,
}: {
  readonly tier: "INFERRED" | "AMBIGUOUS";
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-sm border border-dashed border-sugg-line bg-sugg-wash px-1.5 py-0.5 text-2xs font-semibold text-sugg ${
        tier === "AMBIGUOUS" ? "opacity-60" : ""
      }`}
    >
      {tier === "AMBIGUOUS" ? "Uncertain" : "Suggested"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EdgeDetailPopover({
  edge,
  anchorPosition,
  pending,
  onOpenChange,
  onPromote,
}: EdgeDetailPopoverProps): React.ReactElement {
  return (
    <Popover open={edge !== null} onOpenChange={onOpenChange}>
      {/* Anchored at the click coordinates — a 0-size fixed point, not a
       * visible trigger element (this affordance opens via edge click, not a
       * button). */}
      <PopoverAnchor asChild>
        <span
          className="pointer-events-none fixed size-0"
          style={{ left: anchorPosition?.x ?? 0, top: anchorPosition?.y ?? 0 }}
          aria-hidden
        />
      </PopoverAnchor>
      {edge !== null && (
        <PopoverContent
          align="center"
          className="space-y-3 rounded-card border-rule bg-bright"
        >
          <p className="text-sm font-semibold text-ink">
            Suggested relationship
          </p>

          <div className="space-y-2">
            <DetailRow label="Relation">{edge.relationType}</DetailRow>
            <DetailRow label="Tier">
              <TierBadge tier={edge.tier} />
            </DetailRow>
            {edge.confidence !== undefined && (
              <DetailRow label="Confidence">
                <span className="tabular">
                  {Math.round(edge.confidence * 100)}%
                </span>
              </DetailRow>
            )}
            {edge.provenanceSummary !== undefined && (
              <DetailRow label="Source">{edge.provenanceSummary}</DetailRow>
            )}
          </div>

          <div className="border-t border-hair pt-3">
            <Button
              type="button"
              variant="default"
              className="w-full"
              disabled={pending}
              onClick={onPromote}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              Promote to confirmed
            </Button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
