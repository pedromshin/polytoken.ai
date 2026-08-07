/**
 * ingest-capped-note.test.tsx — vLAUNCH B-lane: the email-detail's one-line
 * explanation for an ingest that finalized 'degraded' with the
 * `ingest_cost_capped` reason (A1 daily cost cap skipped enrichment).
 *
 * The note self-decides: EmailDetail renders it unconditionally (both the
 * embedded/inbox branch and the standalone editor header), and the component
 * returns null for every non-capped input — so absence renders NOTHING,
 * byte-identical to today, until the cost-cap flag flips.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { INGEST_COST_CAPPED_NOTE } from "../../../../_vocabulary/ingest-degradation";
import { IngestCappedNote } from "../ingest-capped-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CAPPED_ERROR =
  "ingest_cost_capped: daily ingest cap reached, enrichment skipped";

const containers: HTMLDivElement[] = [];

async function renderNote(
  props: React.ComponentProps<typeof IngestCappedNote>,
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<IngestCappedNote {...props} />);
  });
  return container;
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("IngestCappedNote (vLAUNCH B-lane)", () => {
  it("renders the shared one-line explanation for a capped email", async () => {
    const container = await renderNote({
      status: "degraded",
      error: CAPPED_ERROR,
    });

    const note = container.querySelector<HTMLElement>(
      '[data-field="ingest-capped-note"]',
    );
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe(INGEST_COST_CAPPED_NOTE);

    // Law 1: chrome speaks quiet ink — no hue, no serif (this is OUR words,
    // not the user's mail), no loud treatment.
    expect(note!.className).not.toMatch(/madder|destructive|red|amber|verdigris/);
    expect(note!.className).not.toContain("font-serif");
  });

  it("renders NOTHING for every non-capped input (byte-identical absence)", async () => {
    const nonCapped: ReadonlyArray<React.ComponentProps<typeof IngestCappedNote>> = [
      { status: "parsed", error: null },
      { status: "received", error: null },
      { status: "degraded", error: null },
      { status: "degraded", error: "adapter_degraded[classifier]: x failed" },
      { status: "failed", error: CAPPED_ERROR },
    ];

    for (const props of nonCapped) {
      const container = await renderNote(props);
      expect(container.innerHTML).toBe("");
    }
  });
});
