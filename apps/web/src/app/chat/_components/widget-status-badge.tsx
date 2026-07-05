"use client";

/**
 * widget-status-badge.tsx — WidgetStatusBadge: one neutral marker Badge per
 * widget-interaction deviation from the unmarked "pending" common case
 * (24-UI-SPEC.md Copywriting Contract, Design Decision 4 — mirrors
 * `TurnStatusBadge`'s "every other status renders nothing" philosophy,
 * applied here as "every status EXCEPT pending renders a badge").
 *
 * Superseded/Stale/Submitted are ALL neutral `variant="secondary"` —
 * distinguished from each other by icon + text, never by color alone
 * (Accessibility: Color contrast / non-color differentiation). Only
 * "Selected" uses the accent `variant="default"`.
 */

import * as React from "react";
import { Ban, Check, CheckCircle2, Clock } from "lucide-react";

import { Badge } from "@nauta/ui/badge";

export type WidgetStatusBadgeKind = "selected" | "superseded" | "stale" | "submitted";

export interface WidgetStatusBadgeProps {
  readonly kind: WidgetStatusBadgeKind;
}

const ICON_CLASS = "size-3";

export function WidgetStatusBadge({ kind }: WidgetStatusBadgeProps): React.ReactElement {
  switch (kind) {
    case "selected":
      return (
        <Badge variant="default" className="gap-1">
          <Check className={ICON_CLASS} aria-hidden />
          Selected
        </Badge>
      );
    case "superseded":
      return (
        <Badge variant="secondary" className="gap-1">
          <Ban className={ICON_CLASS} aria-hidden />
          Superseded
        </Badge>
      );
    case "stale":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className={ICON_CLASS} aria-hidden />
          Stale
        </Badge>
      );
    case "submitted":
      return (
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className={ICON_CLASS} aria-hidden />
          Submitted
        </Badge>
      );
  }
}
