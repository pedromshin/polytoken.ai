"use client";

/**
 * pipeline-health-panel.tsx — the inbox rail's Pipeline health panel.
 *
 * Answers "did my forwarded mail actually make it through analysis?" without
 * leaving the inbox: per importer, how many emails were received, how many
 * are fully analyzed, and how many failed at which pipeline stage.
 *
 * Data path: GET /api/pipeline/health (the server-keyed Next proxy) →
 * listener GET /v1/pipeline/health (being built in a sibling lane — see the
 * INTEGRATION POINT notes in src/lib/pipeline-health.ts and the proxy
 * route). Until the endpoint lands, the panel shows its honest framed error
 * state with a Retry — never fake numbers, never an infinite skeleton
 * (the UI-5 lesson: errors get a frame and a retry, not a shimmer).
 *
 * Identity (D-58-01): pure chrome — monochrome ink/pencil (law 1), tabular
 * numerals for counts (law 2's numerals rule), failures announced by a glyph
 * + border-rule frame, never a hue (the madder rule: no colour on a STATE).
 * No font-medium (500) — only 400/600.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";

import { shapePipelineHealth, type PipelineHealthRow } from "~/lib/pipeline-health";

// ---------------------------------------------------------------------------
// Data hook — plain fetch + state (mirrors this repo's promoteEdge
// plain-fetch convention for proxy routes; no tRPC procedure exists for a
// listener-owned aggregate). Exported for direct behavioral testing.
// ---------------------------------------------------------------------------

export type PipelineHealthState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly rows: ReadonlyArray<PipelineHealthRow> };

export function usePipelineHealth(): {
  readonly state: PipelineHealthState;
  readonly reload: () => void;
} {
  const [state, setState] = useState<PipelineHealthState>({ status: "loading" });
  // Bumping this re-runs the fetch effect (the Retry affordance).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch("/api/pipeline/health", { method: "GET" });
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        const rows = shapePipelineHealth(body);
        if (rows === null) {
          // Contract drift or malformed payload — an honest error beats
          // rendering NaN counts.
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", rows });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setAttempt((prev) => prev + 1);
  }, []);

  return { state, reload };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineHealthPanel(): React.ReactElement {
  const { state, reload } = usePipelineHealth();

  return (
    <section aria-label="Pipeline health" className="px-2">
      <div className="mb-2 text-2xs font-semibold tracking-[0.07em] text-pencil uppercase">
        Pipeline health
      </div>

      {state.status === "loading" && (
        <div aria-hidden className="space-y-1.5">
          <Skeleton className="h-3 w-28 rounded-sm" />
          <Skeleton className="h-3 w-20 rounded-sm" />
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="border border-rule p-2.5">
          <p className="text-xs font-semibold text-ink">
            Pipeline status unavailable.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={reload}
          >
            Retry
          </Button>
        </div>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p className="text-xs text-faded">
          No pipeline activity yet — counts appear as mail arrives.
        </p>
      )}

      {state.status === "ready" && state.rows.length > 0 && (
        <ul className="flex flex-col gap-2.5" aria-label="Per-importer pipeline counts">
          {state.rows.map((row) => (
            <li key={row.importerId} className="text-xs">
              <div className="truncate font-semibold text-ink" title={row.displayName}>
                {row.displayName}
              </div>
              <div className="tabular mt-0.5 text-pencil">
                {row.received} received · {row.fullyAnalyzed} analyzed
              </div>
              {row.failedTotal > 0 && (
                <div className="mt-1 border border-rule p-1.5">
                  <div className="flex items-center gap-1 font-semibold text-ink">
                    <TriangleAlert className="size-3 shrink-0" aria-hidden />
                    <span className="tabular">{row.failedTotal} failed</span>
                  </div>
                  <ul className="tabular mt-0.5 text-pencil" aria-label="Failures by stage">
                    {row.failedByStage.map((failure) => (
                      <li key={failure.stage}>
                        {failure.stage} × {failure.count}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
