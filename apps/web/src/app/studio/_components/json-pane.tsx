"use client";

/**
 * json-pane.tsx — shared studio debug pane (FIX-05, 26-UI-SPEC.md § "FIX-05").
 *
 * Replaces the 3 near-identical raw `<ScrollArea><pre>{JSON.stringify(...)}</pre>
 * </ScrollArea>` blocks previously duplicated across generation-sandbox-island.tsx,
 * history-island.tsx, and preview/page.tsx with one component that also adds the
 * copy-to-clipboard affordance none of the three had.
 *
 * App-local per 26-CONTEXT.md — a debug/inspector affordance, not a `packages/ui`
 * design-system primitive. Call sites keep their own `bg-muted` outer wrapper;
 * this component renders only the header bar + scrollable JSON body so it slots
 * into an existing `flex flex-col` container unchanged.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { ScrollArea } from "@polytoken/ui/scroll-area";

/** Duration the Check icon stays visible after a successful copy (turn-action-row.tsx idiom). */
const COPIED_RESET_MS = 1500;

export interface JsonPaneProps {
  readonly value: unknown;
  readonly label?: string;
}

/**
 * JsonPane — labeled header bar + scrollable, formatted JSON body with a ghost
 * icon-only copy button (Copy -> Check swap on click, resets after COPIED_RESET_MS).
 */
export function JsonPane({
  value,
  label = "Spec JSON",
}: JsonPaneProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  // Single source of truth for 2-space indentation — reused by both the
  // rendered <pre> body and the clipboard write.
  const formatted = JSON.stringify(value, null, 2);

  const handleCopy = useCallback((): void => {
    void navigator.clipboard.writeText(formatted).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  }, [formatted]);

  return (
    <>
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label="Copy JSON"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <pre className="p-4 font-code text-xs text-foreground">{formatted}</pre>
      </ScrollArea>
    </>
  );
}
