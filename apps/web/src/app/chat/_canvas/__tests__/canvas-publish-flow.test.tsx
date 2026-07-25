/**
 * canvas-publish-flow.test.tsx — Phase 73 Wave B (LCAN-04). End-to-end proof
 * that a source node's PUBLISHED value flows through the UNCHANGED
 * usePanelData/resolveCanvasPath engine to a wired target, and that a SECOND
 * publish re-resolves the same target live (a subscription, not a snapshot).
 *
 * Zero mocks: real createCanvasStore, real useCanvasPublish, real usePanelData.
 * Uses the repo's createRoot-in-jsdom + `act` convention (see panel-data-flow).
 */

import * as React from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { publishedNodePath } from "../canvas-publish";
import { createCanvasStore } from "../canvas-store";
import {
  CanvasStoreProvider,
  useCanvasPublish,
  usePanelData,
  type IncomingDataEdge,
} from "../canvas-store-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE_ID = "agent:sheet";
const TARGET_ID = "agent:tile";

// The physical edge sourcePath the reconcile rewrite produces for a model
// `sourcePath: "total"` from the "sheet" handle (use-canvas-persistence.ts).
const INCOMING_EDGES: readonly IncomingDataEdge[] = [
  { sourcePath: `${publishedNodePath(SOURCE_ID)}.total`, targetKey: "input" },
];

/** A source node that publishes {total} through the publish port when its
 * "settle" button is clicked (stands in for a tRPC query resolving). */
function SourceHarness({ total }: { readonly total: number }): React.ReactElement {
  const publish = useCanvasPublish(SOURCE_ID);
  return (
    <button
      type="button"
      aria-label="settle"
      onClick={() => publish({ total, currency: "USD" })}
    >
      settle
    </button>
  );
}

/** The wired target: one incoming data edge from the source's published total. */
function TargetHarness(): React.ReactElement {
  const { data } = usePanelData(TARGET_ID, INCOMING_EDGES);
  return <span data-testid="target-input">{String(data.input)}</span>;
}

describe("publish port -> wired edge -> live target (LCAN-04)", () => {
  it("carries a published value to a wired target and re-resolves on the next publish", async () => {
    const store = createCanvasStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = (await import("react-dom/client")).createRoot(container);

    function App({ total }: { readonly total: number }): React.ReactElement {
      return (
        <CanvasStoreProvider store={store}>
          <SourceHarness total={total} />
          <TargetHarness />
        </CanvasStoreProvider>
      );
    }

    await act(async () => {
      root.render(<App total={100} />);
    });

    // Before the source settles, the wired target resolves to undefined.
    expect(container.querySelector('[data-testid="target-input"]')?.textContent).toBe(
      "undefined",
    );

    const settle = container.querySelector('[aria-label="settle"]') as HTMLButtonElement;
    await act(async () => {
      settle.click();
    });

    // The published bounded projection landed under shared.published.{id}...
    expect(store.getState().read(`${publishedNodePath(SOURCE_ID)}.total`)).toBe(100);
    // ...and the live-subscribed target resolves it with no remount/refresh.
    expect(container.querySelector('[data-testid="target-input"]')?.textContent).toBe("100");

    // A SECOND settle with a new total re-resolves the SAME target span.
    await act(async () => {
      root.render(<App total={250} />);
    });
    const settle2 = container.querySelector('[aria-label="settle"]') as HTMLButtonElement;
    await act(async () => {
      settle2.click();
    });

    expect(store.getState().read(`${publishedNodePath(SOURCE_ID)}.total`)).toBe(250);
    expect(container.querySelector('[data-testid="target-input"]')?.textContent).toBe("250");

    root.unmount();
    document.body.removeChild(container);
  });
});
