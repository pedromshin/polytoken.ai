"use client";

/**
 * generation-sandbox-island.tsx — Interactive intent → spec generation sandbox.
 *
 * Layout (15-UI-SPEC §6–§8):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Textarea (intent)  [Generate button]      shrink-0 header  │
 *   ├───────────────────────────────────┬─────────────────────────┤
 *   │  [GenerationStateChrome]          │                         │
 *   ├───────────────────────────────────┤                         │
 *   │  SpecRendererIsland (55)          │  Spec JSON (45)         │
 *   └───────────────────────────────────┴─────────────────────────┘
 *
 * Interaction contract (15-UI-SPEC §7 / D-06):
 *   - tRPC query is created with `enabled: false` — never fires automatically.
 *   - `await q.refetch()` on Generate button click — manual trigger only.
 *   - Chrome row is shown once isPending or a generation result is present.
 *   - 55/45 ResizablePanelGroup mirrors /studio/preview/page.tsx verbatim (D-09).
 *
 * Actions wiring (D-08):
 *   - buildActionRegistry supplies navigate / setState / query-refresh handlers.
 *   - Sandbox passes a minimal declaredState seam { state: {}, dispatch: () => {} }
 *     because SpecRenderer materialises its own declared state via useDeclaredState
 *     internally — the sandbox itself never reads or writes declared state.
 *   - SEAM-02: mutate intentionally absent from buildActionRegistry (action-handlers.ts).
 *
 * Security:
 *   - No eval / Function / dangerouslySetInnerHTML (D-15 / T-15-10 / GR-01).
 *   - No NEXT_PUBLIC_ secret usage. EMAIL_LISTENER_API_KEY is server-side only.
 *   - All mutation of state via immutable spread/new objects (CLAUDE.md).
 */

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@nauta/ui/button";
import { Textarea } from "@nauta/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@nauta/ui/resizable";
import { ScrollArea } from "@nauta/ui/scroll-area";

import { api } from "~/trpc/react";
import { buildActionRegistry } from "@nauta/genui/renderer";
import type { SpecRoot } from "@nauta/genui/schema";

import { SpecRendererIsland } from "./spec-renderer-island";
import { GenerationStateChrome } from "./generation-state-chrome";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tracks generation result across refetch cycles. */
interface GenerationResult {
  readonly outcome: "ok" | "fallback" | "escalated";
  readonly spec: SpecRoot;
  readonly cacheHit: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GenerationSandboxIsland — wires the intent textarea, Generate button,
 * GenerationStateChrome, and 55/45 render / spec-JSON panel group.
 *
 * "use client" — tRPC hooks + router + local state require client context.
 */
export function GenerationSandboxIsland(): React.ReactElement {
  // Local input state (controlled Textarea)
  const [intent, setIntent] = useState<string>("");

  // Last generation result (undefined = no generation started yet)
  const [lastResult, setLastResult] = useState<GenerationResult | undefined>(
    undefined,
  );

  // WR-01: transport/query error state — set when refetch completes with no data
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // Router for buildActionRegistry (navigate handler)
  const router = useRouter();

  // tRPC utils for buildActionRegistry (query-refresh handler)
  const utils = api.useUtils();

  // D-06: enabled:false — never fires automatically. Manually triggered via refetch().
  // Pattern mirrors inbox-three-pane.tsx lines 232-246.
  const q = api.genui.generate.useQuery(
    { intent: intent.trim() || " " },
    { enabled: false },
  );

  // Build ActionRegistry for the renderer — minimal declaredState seam (D-08 / SEAM-02).
  // SpecRenderer materialises declared state internally via useDeclaredState;
  // the sandbox does not need to read or write it at this layer.
  const actions = buildActionRegistry({
    router,
    trpcUtils: utils,
    declaredState: { state: {}, dispatch: () => undefined },
  });

  // Generate button handler — D-06 manual trigger only
  const handleGenerate = useCallback(async (): Promise<void> => {
    const trimmed = intent.trim();
    if (trimmed.length === 0) return;
    // WR-01: clear any prior error before each attempt
    setLastError(undefined);
    const result = await q.refetch();
    if (result.data !== undefined) {
      setLastError(undefined);
      setLastResult({
        outcome: result.data.outcome,
        spec: result.data.spec,
        cacheHit: result.data.cacheHit,
        ...(result.data.reason !== undefined && { reason: result.data.reason }),
      });
    } else if (result.error !== null && result.error !== undefined) {
      // WR-01: surface transport/query error — no data came back at all
      setLastError("Generation failed. Please try again.");
    }
  }, [intent, q]);

  // Keyboard submit — Enter without Shift submits (§7 interaction contract)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleGenerate();
      }
    },
    [handleGenerate],
  );

  // Whether to show the chrome row (isPending or a result exists)
  const showChrome = q.isFetching || lastResult !== undefined;

  // The spec to render: last successful data from the query, or undefined.
  // WR-02: typed as SpecRoot — q.data.spec is SpecRoot (tRPC output validated),
  // lastResult.spec is SpecRoot (interface field typed above). No cast needed.
  const specToRender: SpecRoot | undefined = q.data?.spec ?? lastResult?.spec;

  // Chrome props derived from live query state + lastResult
  const chromeProps = {
    isPending: q.isFetching,
    outcome: q.data?.outcome ?? lastResult?.outcome,
    cacheHit: q.data?.cacheHit ?? lastResult?.cacheHit,
    reason: q.data?.reason ?? lastResult?.reason,
  };

  return (
    <div className="flex h-full flex-col">
      {/* Intent input strip — shrink-0, no scroll */}
      <div
        className="flex shrink-0 items-start gap-3 border-b border-border/50 p-4"
        role="search"
        aria-label="Generate UI specification"
      >
        <Textarea
          aria-label="Describe the UI you want to generate"
          placeholder="Describe the view you want to generate — e.g. 'Show top 5 open threads grouped by sender with reply button'"
          value={intent}
          onChange={(e): void => setIntent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="flex-1 resize-none text-sm"
          disabled={q.isFetching}
          aria-busy={q.isFetching}
          aria-controls="sandbox-output-region"
        />
        <Button
          onClick={(): void => { void handleGenerate(); }}
          disabled={q.isFetching || intent.trim().length === 0}
          aria-label={q.isFetching ? "Generating, please wait" : "Generate UI"}
          className="shrink-0"
        >
          {q.isFetching ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Generating
            </>
          ) : (
            "Generate"
          )}
        </Button>
      </div>

      {/* WR-01: transport/query error alert — shown when generation fails with no spec */}
      {!showChrome && lastError !== undefined && (
        <div role="alert" className="px-4 pt-2 text-sm text-destructive">
          {lastError}
        </div>
      )}

      {/* Empty state — before any generation (§8) */}
      {!showChrome && lastError === undefined && (
        <div
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
          aria-live="polite"
        >
          Enter an intent above and click Generate to preview the rendered spec.
        </div>
      )}

      {/* Output area — generation chrome + 55/45 panel split (§6 / D-09) */}
      {showChrome && (
        <div
          id="sandbox-output-region"
          role="region"
          aria-label="Generation output"
          aria-expanded={specToRender !== undefined}
          className="flex flex-1 min-h-0 flex-col"
        >
          {/* GenerationStateChrome — four-state chrome row (UI-SPEC §9) */}
          <GenerationStateChrome {...chromeProps} />

          {/* 55/45 ResizablePanelGroup — mirrors /studio/preview/page.tsx verbatim (D-09) */}
          {specToRender !== undefined && (
            <ResizablePanelGroup direction="horizontal" className="h-full flex-1">
              {/* Left: rendered spec output */}
              <ResizablePanel defaultSize={55} minSize={30}>
                <div
                  role="region"
                  aria-label="Rendered output"
                  className="h-full overflow-y-auto p-6"
                >
                  <SpecRendererIsland spec={specToRender} actions={actions} />
                </div>
              </ResizablePanel>

              <ResizableHandle />

              {/* Right: spec JSON */}
              <ResizablePanel defaultSize={45} minSize={25}>
                <div
                  role="region"
                  aria-label="Spec JSON"
                  className="flex h-full flex-col bg-muted"
                >
                  <div className="shrink-0 border-b border-border/50 px-4 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Spec JSON
                    </span>
                  </div>
                  <ScrollArea className="flex-1">
                    <pre className="p-4 font-mono text-xs text-foreground">
                      {JSON.stringify(specToRender, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      )}
    </div>
  );
}
