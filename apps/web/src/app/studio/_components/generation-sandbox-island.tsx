"use client";

/**
 * generation-sandbox-island.tsx — Interactive intent → spec generation sandbox.
 *
 * Layout (15-UI-SPEC §6–§8):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Textarea (intent)  [Style Pack dropdown]  [Generate]       │
 *   ├───────────────────────────────────┬─────────────────────────┤
 *   │  [GenerationStateChrome]          │                         │
 *   ├───────────────────────────────────┤                         │
 *   │  SpecRendererIsland (55)          │  Spec JSON (45)         │
 *   └───────────────────────────────────┴─────────────────────────┘
 *
 * Style pack selection (D-04 / Phase 17-03):
 *   - Dropdown lists all 6 curated packs + "Auto / Surprise" sentinel.
 *   - "Auto / Surprise" sentinel resolves to a concrete pack id via
 *     pickSurprisePack() before the tRPC call — "auto" is NEVER sent to FastAPI (D-08).
 *   - Default selection: DEFAULT_PACK_ID ("nauta-teal").
 *   - Selected pack id threads through tRPC stylePackId → FastAPI style_pack_id.
 *   - Pack provenance badge shown near the rendered result (which pack was used).
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

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nauta/ui/select";
import { Badge } from "@nauta/ui/badge";

import { api } from "~/trpc/react";
import { buildActionRegistry } from "@nauta/genui/renderer";
import { STYLE_PACKS, STYLE_PACK_IDS, DEFAULT_PACK_ID } from "@nauta/genui/theme";
import type { SpecRoot } from "@nauta/genui/schema";
import type { StylePackId } from "@nauta/genui/theme";

import { SpecRendererIsland } from "./spec-renderer-island";
import { GenerationStateChrome } from "./generation-state-chrome";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel value for the "Auto / Surprise" dropdown option. */
const AUTO_SENTINEL = "auto" as const;

/** All pack options for the dropdown. */
const PACK_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: AUTO_SENTINEL, label: "Auto / Surprise" },
  ...STYLE_PACK_IDS.map((id) => ({
    value: id,
    label: STYLE_PACKS[id as StylePackId]?.label ?? id,
  })),
];

// ---------------------------------------------------------------------------
// pickSurprisePack — D-04 / D-08
// ---------------------------------------------------------------------------

/**
 * Resolves "Auto / Surprise" to a concrete, randomly-selected pack id.
 *
 * D-08 contract: "auto" is NEVER sent to FastAPI. This helper always returns
 * a valid StylePackId from STYLE_PACK_IDS. Callers invoke this before the
 * tRPC query to obtain a concrete id.
 *
 * Distribution: uniform random across all known packs (including nauta-teal).
 */
export function pickSurprisePack(): StylePackId {
  // % length guards against the theoretical edge case where Math.random() returns
  // exactly 1.0 (some JS engines), which would make Math.floor yield length and
  // produce an out-of-bounds undefined instead of a valid StylePackId (IN-04).
  const idx = Math.floor(Math.random() * STYLE_PACK_IDS.length) % STYLE_PACK_IDS.length;
  return STYLE_PACK_IDS[idx] as StylePackId;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tracks generation result across refetch cycles. */
interface GenerationResult {
  readonly outcome: "ok" | "fallback" | "escalated";
  readonly spec: SpecRoot;
  readonly cacheHit: boolean;
  readonly reason?: string;
  /** The concrete pack id that was used for this generation (never "auto"). */
  readonly resolvedPackId: StylePackId;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface GenerationSandboxIslandProps {
  /**
   * Optional prompt pre-seeded from the Page Ideas tab (D-21 / D-06).
   *
   * D-06: This prop seeds the intent textarea ONLY; it NEVER auto-triggers
   * generation. The user must still click the Generate button manually.
   */
  readonly initialIntent?: string;
}

// ---------------------------------------------------------------------------
// GenerationSandboxIsland
// ---------------------------------------------------------------------------

/**
 * GenerationSandboxIsland — wires the intent textarea, style-pack dropdown,
 * Generate button, GenerationStateChrome, and 55/45 render / spec-JSON panel group.
 *
 * "use client" — tRPC hooks + router + local state require client context.
 */
export function GenerationSandboxIsland({
  initialIntent,
}: GenerationSandboxIslandProps): React.ReactElement {
  // Local input state (controlled Textarea)
  // Seeded from initialIntent prop if provided; empty otherwise.
  const [intent, setIntent] = useState<string>(() => initialIntent ?? "");

  // D-06: When initialIntent changes (e.g. user picks a new Page Idea),
  // update the textarea WITHOUT triggering generation.
  // The user must still manually click Generate.
  useEffect(() => {
    if (initialIntent !== undefined) {
      setIntent(initialIntent);
    }
  }, [initialIntent]);

  // Style pack selection — default to nauta-teal pack (D-04)
  // Value may be AUTO_SENTINEL or a concrete StylePackId.
  const [selectedPack, setSelectedPack] = useState<string>(DEFAULT_PACK_ID);

  // Resolved pack id used for the last generation (for provenance badge display)
  const [lastResult, setLastResult] = useState<GenerationResult | undefined>(
    undefined,
  );

  // WR-01: transport/query error state — set when refetch completes with no data
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // Router for buildActionRegistry (navigate handler)
  const router = useRouter();

  // tRPC utils for buildActionRegistry (query-refresh handler)
  const utils = api.useUtils();

  // The concrete pack id to use for the CURRENT query (updated on each generate click).
  // Starts as DEFAULT_PACK_ID; replaced with pickSurprisePack() when AUTO_SENTINEL selected.
  const [queryPackId, setQueryPackId] = useState<StylePackId>(DEFAULT_PACK_ID);

  // D-06: enabled:false — never fires automatically. Manually triggered via refetch().
  // stylePackId is validated at web boundary via z.enum(STYLE_PACK_IDS) in generate.ts.
  const q = api.genui.generate.useQuery(
    { intent: intent.trim() || " ", stylePackId: queryPackId },
    { enabled: false },
  );

  // Build ActionRegistry for the renderer — minimal declaredState seam (D-08 / SEAM-02).
  // SpecRenderer materialises declared state internally via useDeclaredState;
  // the sandbox does not need to read or write it at this layer.
  const actions = useMemo(
    () =>
      buildActionRegistry({
        router,
        trpcUtils: utils,
        declaredState: { state: {}, dispatch: () => undefined },
      }),
    [router, utils],
  );

  // Generate button handler — D-06 manual trigger only
  const handleGenerate = useCallback(async (): Promise<void> => {
    const trimmed = intent.trim();
    if (trimmed.length === 0) return;

    // D-08: resolve "auto" to a concrete pack id BEFORE calling tRPC.
    // pickSurprisePack() always returns a valid StylePackId — never sends "auto" to FastAPI.
    const concretePackId: StylePackId =
      selectedPack === AUTO_SENTINEL ? pickSurprisePack() : (selectedPack as StylePackId);

    // Update query pack id state — triggers query key update for refetch
    setQueryPackId(concretePackId);

    // WR-01: clear any prior error before each attempt
    setLastError(undefined);

    const result = await q.refetch();
    if (result.data !== undefined) {
      setLastError(undefined);
      setLastResult({
        outcome: result.data.outcome,
        spec: result.data.spec,
        cacheHit: result.data.cacheHit,
        resolvedPackId: concretePackId,
        ...(result.data.reason !== undefined && { reason: result.data.reason }),
      });
    } else if (result.error !== null && result.error !== undefined) {
      // WR-01: surface transport/query error — no data came back at all
      setLastError("Generation failed. Please try again.");
    }
  }, [intent, selectedPack, q]);

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

  // The resolved pack id to show in the provenance badge.
  const displayPackId: StylePackId | undefined = lastResult?.resolvedPackId;
  const displayPackName: string | undefined =
    displayPackId !== undefined
      ? (STYLE_PACKS[displayPackId]?.label ?? displayPackId)
      : undefined;

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
        className="flex shrink-0 flex-col gap-3 border-b border-border/50 p-4"
        role="search"
        aria-label="Generate UI specification"
      >
        {/* Row 1: Textarea */}
        <Textarea
          aria-label="Describe the UI you want to generate"
          placeholder="Describe the view you want to generate — e.g. 'Show top 5 open threads grouped by sender with reply button'"
          value={intent}
          onChange={(e): void => setIntent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full resize-none text-sm"
          disabled={q.isFetching}
          aria-busy={q.isFetching}
          aria-controls="sandbox-output-region"
        />

        {/* Row 2: Style pack dropdown + Generate button */}
        <div className="flex items-center gap-3">
          {/* D-04: Style pack selector — all 6 packs + Auto/Surprise sentinel */}
          <Select
            value={selectedPack}
            onValueChange={(value): void => setSelectedPack(value)}
            disabled={q.isFetching}
          >
            <SelectTrigger
              className="w-48 shrink-0 text-sm"
              aria-label="Select visual theme"
            >
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              {PACK_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
                  className="flex h-full flex-col overflow-y-auto"
                >
                  {/* Pack provenance badge — D-04: shows which pack was used */}
                  {displayPackName !== undefined && (
                    <div className="shrink-0 px-6 pt-4 pb-2">
                      <Badge
                        variant="secondary"
                        aria-label={`Visual theme: ${displayPackName}`}
                      >
                        Theme: {displayPackName}
                      </Badge>
                    </div>
                  )}
                  <div className="flex-1 p-6 pt-2">
                    <SpecRendererIsland spec={specToRender} actions={actions} />
                  </div>
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
