/**
 * use-canvas-persistence-edges-stable.test.tsx — regression for the
 * "Maximum update depth exceeded" infinite render loop (found live 2026-07-06,
 * opening the canvas view on a fresh conversation with no saved layout).
 *
 * Root cause: `initialEdges` was `validatedRow?.edges ?? []` — a NEW `[]`
 * allocated every render whenever no saved layout row exists. `initialEdges`
 * is a dependency of chat-canvas.tsx's reconcile effect (which calls setNodes),
 * so an unstable reference re-fired that effect on every render → setNodes →
 * re-render → new `[]` → loop. `initialNodes` right beside it was already
 * memoized, which is why only edges slipped through — and why the existing
 * DB-free pure-helper tests (which never mount the hook) missed it.
 *
 * This mounts the ACTUAL hook (tRPC query mocked to "no saved layout") inside a
 * probe, force-re-renders it, and asserts `initialEdges` keeps a STABLE
 * reference across renders. Fails on the old `?? []`; passes on the memoized
 * fallback. Uses raw react-dom/client + act (this package's convention — no
 * @testing-library).
 */

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getCanvasLayout: {
        // No saved layout for this conversation — the exact case that looped.
        useQuery: () => ({ data: null, isPending: false }),
      },
      saveCanvasLayout: {
        useMutation: () => ({ mutate: () => undefined }),
      },
    },
  },
}));

import { useCanvasPersistence } from "../use-canvas-persistence";

const CONVERSATION_ID = "00000000-0000-0000-0000-0000000000c1";

let container: HTMLDivElement;
let root: Root;
let forceRerender: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useCanvasPersistence — initialEdges reference stability (loop regression)", () => {
  it("returns the SAME initialEdges reference across re-renders when no layout is saved", () => {
    const capturedEdges: ReadonlyArray<unknown>[] = [];
    const capturedNodes: ReadonlyArray<unknown>[] = [];

    function Probe(): null {
      const { initialEdges, initialNodes } = useCanvasPersistence({
        conversationId: CONVERSATION_ID,
        nodes: [],
        edges: [],
        viewport: null,
      });
      capturedEdges.push(initialEdges);
      capturedNodes.push(initialNodes);
      return null;
    }

    function Harness(): React.ReactElement {
      const [, setN] = React.useState(0);
      forceRerender = () => setN((n) => n + 1);
      return <Probe />;
    }

    act(() => root.render(<Harness />));
    act(() => forceRerender());
    act(() => forceRerender());

    // A fresh `[]` each render (the bug) makes these differ, which re-fires
    // chat-canvas.tsx's reconcile effect forever ("Maximum update depth").
    expect(capturedEdges.length).toBeGreaterThanOrEqual(3);
    for (const edges of capturedEdges) {
      expect(edges).toBe(capturedEdges[0]);
      expect(edges).toHaveLength(0);
    }
    // Sibling invariant: initialNodes was already stable — keep it that way.
    for (const nodes of capturedNodes) {
      expect(nodes).toBe(capturedNodes[0]);
    }
  });
});
