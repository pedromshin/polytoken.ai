/**
 * render-extraction-panel.tsx — the ONE way `ExtractionSummaryPanel` is
 * mounted by both `capture-extraction-baseline.test.tsx` (60-05-PLAN.md Task
 * 1, which froze the pre-60 fingerprint from this exact render) and
 * `extraction-summary-structure.test.tsx` (Task 3, which asserts the post-60
 * fingerprint differs from that baseline).
 *
 * The PROPS are as load-bearing as the fixture. `onConfirmEntity` decides
 * whether the confirm affordance renders at all, and `confirmingEntityIds`
 * decides between the Check icon and the Loader2 spinner — so a Task 3 mount
 * that passed different props would move `shape` for reasons that have nothing
 * to do with the redesign, and the delta gate would pass for the wrong reason.
 * Sharing the whole render, not just the fixture, makes that impossible rather
 * than merely unlikely.
 *
 * Not a `.test.tsx`, so vitest's `include` never collects it as a suite (and
 * importing it registers no tests — unlike importing a helper from a sibling
 * test file, which would re-run that file's describes).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ExtractionSummaryPanel } from "../../extraction-summary-panel";
import { EXTRACTION_FIXTURE } from "./extraction-fixture";

/**
 * Mounts the panel with the confirm affordance ENABLED (so the candidate
 * entity's button branch renders) and nothing in flight (so the spinner branch
 * stays off, keeping the render deterministic).
 */
export async function renderExtractionPanel(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ExtractionSummaryPanel
        components={EXTRACTION_FIXTURE}
        onConfirmEntity={() => undefined}
        confirmingEntityIds={new Set<string>()}
      />,
    );
  });
  return container;
}
