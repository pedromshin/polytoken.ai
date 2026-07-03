import { Badge } from "@nauta/ui/badge";

import type { RouterOutputs } from "@nauta/api-client";

export type ChatModelEntry = RouterOutputs["chat"]["models"]["models"][number];

export interface ModelPickerEntryProps {
  readonly model: ChatModelEntry;
  readonly isRecommended: boolean;
}

// ---------------------------------------------------------------------------
// Pure formatting helpers — exported for reuse (D-05/D-06 honesty contract).
// ---------------------------------------------------------------------------

/** "200K ctx" / "8K ctx" — never a raw token count (22-UI-SPEC.md capability row). */
export function formatContextTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K ctx`;
  }
  return `${tokens} ctx`;
}

/**
 * "Tools ✓ · GenUI ✓ · 128K ctx" or "Tools ✗ · GenUI ✗ (text only) · 8K ctx"
 * (D-05) — every flag always renders, present AND absent, never omitted.
 */
export function formatCapabilityRow(
  capabilities: ChatModelEntry["capabilities"],
): string {
  const tools = `Tools ${capabilities.tools ? "✓" : "✗"}`;
  const genui = `GenUI ${capabilities.genui ? "✓" : "✗"}${
    capabilities.genui ? "" : " (text only)"
  }`;
  const ctx = formatContextTokens(capabilities.contextTokens);
  return `${tools} · ${genui} · ${ctx}`;
}

/** "~$3.00 in · $15.00 out / 1M tok" (D-06) — both real rates, neither hidden. */
export function formatCostLine(
  priceInPerMtok: number,
  priceOutPerMtok: number,
): string {
  return `~$${priceInPerMtok.toFixed(2)} in · $${priceOutPerMtok.toFixed(2)} out / 1M tok`;
}

/**
 * ModelPickerEntry (D-04..D-06) — one row inside the cmdk Command list.
 * Always visible (never hover-gated, 22-UI-SPEC.md Accessibility): name,
 * an honest capability row, a cost line or the browser "Local · Free" badge,
 * and the server-authored "Best for" caption rendered verbatim (T-22-39 —
 * render the registry, never reinterpret its wording). The last-used/
 * default entry carries a primary "Recommended" outline — the one picker
 * element allowed the accent color (D-10).
 */
export function ModelPickerEntry({
  model,
  isRecommended,
}: ModelPickerEntryProps): React.ReactElement {
  const isBrowser = model.executionLocus === "browser";

  return (
    <div className="flex w-full flex-col gap-1 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-foreground">
          {model.displayName}
        </span>
        {isRecommended && (
          <Badge
            variant="outline"
            className="shrink-0 border-primary text-primary"
          >
            Recommended
          </Badge>
        )}
      </div>
      <span className="text-xs font-semibold text-muted-foreground">
        {formatCapabilityRow(model.capabilities)}
      </span>
      {isBrowser ? (
        <Badge variant="secondary" className="w-fit">
          Local · Free
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">
          {formatCostLine(model.priceInPerMtok, model.priceOutPerMtok)}
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        Best for: {model.bestFor}
      </span>
    </div>
  );
}
