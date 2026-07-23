/**
 * parse-status-marker.test.tsx — ING-6: the failed/degraded parse states are
 * REACHABLE now (the listener drives the lifecycle), so the marker must render
 * them visibly distinct from a clean parse, and must surface the recorded
 * parse_error.
 *
 * What is asserted is USER-VISIBLE behavior:
 *   - the marker shows the status word itself;
 *   - a failed email reads louder than a parsed one (ink text + ink border vs
 *     the faded/rule quiet state — distinct tone classes, survives greyscale);
 *   - the recorded parse_error is exposed on the failed marker (title attr),
 *     and NEVER on a healthy one;
 *   - law 1 holds: no madder/destructive hue is spent on a retryable status.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ParseStatusMarker } from "../parse-status-marker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const containers: HTMLDivElement[] = [];

async function renderMarker(
  props: React.ComponentProps<typeof ParseStatusMarker>,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ParseStatusMarker {...props} />);
  });
  const marker = container.querySelector<HTMLElement>(
    '[data-field="parse-status"]',
  );
  if (marker === null) throw new Error("parse-status marker did not render");
  return marker;
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("ParseStatusMarker (ING-6)", () => {
  it("renders the status word the listener recorded", async () => {
    const marker = await renderMarker({ status: "failed" });
    expect(marker.textContent).toBe("failed");
  });

  it("a failed email does not read like a cleanly parsed one", async () => {
    const failed = await renderMarker({
      status: "failed",
      error: "attachment bl.pdf: RuntimeError('corrupt PDF stream')",
    });
    const parsed = await renderMarker({ status: "parsed", error: null });

    // Distinct tone: failure is loud in ink weight (text + border), the
    // clean parse is quiet chrome.
    expect(failed.className).not.toBe(parsed.className);
    expect(failed.className).toContain("text-ink");
    expect(failed.className).toContain("border-ink");
    expect(parsed.className).toContain("text-faded");
    expect(parsed.className).not.toContain("border-ink");
  });

  it("surfaces the recorded parse_error on the failed marker only", async () => {
    const error = "attachment bl.pdf: RuntimeError('corrupt PDF stream')";
    const failed = await renderMarker({ status: "failed", error });
    expect(failed.getAttribute("title")).toBe(error);

    // A healthy email never carries a stale error tooltip.
    const parsed = await renderMarker({ status: "parsed", error });
    expect(parsed.getAttribute("title")).toBeNull();
  });

  it("treats 'degraded' as a failure state (same distinct tone + error)", async () => {
    const degraded = await renderMarker({
      status: "degraded",
      error: "attachment scan.pdf: parse failed",
    });
    expect(degraded.textContent).toBe("degraded");
    expect(degraded.className).toContain("text-ink");
    expect(degraded.className).toContain("border-ink");
    expect(degraded.getAttribute("title")).toContain("scan.pdf");
  });

  it("law 1: a retryable status never spends the madder/destructive hue", async () => {
    const failed = await renderMarker({ status: "failed", error: "boom" });
    expect(failed.className).not.toMatch(/madder|destructive|red/);
  });
});
