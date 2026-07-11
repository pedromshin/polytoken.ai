/**
 * knowledge-graph-invalidate.test.tsx — BIND-02 event-driven cache
 * invalidation (Phase 33 Task 2), T-33-06 mitigation proof.
 *
 * Exercises the standalone `promoteEdge` orchestration exported from
 * `knowledge-graph.tsx` (the same fetch + invalidate logic `handlePromote`
 * calls) directly, with a mocked `global.fetch` and a mocked `PromoteEdgeUtils`
 * shape (`{ knowledge: { byId: { invalidate }, graph: { invalidate } } }`) —
 * no ReactFlow canvas host is mounted (this package has no ResizeObserver/
 * DOMMatrixReadOnly jsdom polyfills, and no other test in this repo mounts
 * the real `<ReactFlow>`; `panel-data-flow.test.tsx`/
 * `interactive-widget-canvas.test.tsx` establish the same "reproduce the
 * production seam without the ReactFlow host" precedent).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { promoteEdge, type PromoteEdgeUtils } from "../knowledge-graph";

const EDGE_ID = "edge-123";
const IMPORTER_ID = "00000000-0000-0000-0000-000000000001";

function makeUtils(): PromoteEdgeUtils {
  return {
    knowledge: {
      byId: { invalidate: vi.fn() },
      graph: { invalidate: vi.fn() },
      expandNode: { invalidate: vi.fn() },
    },
  };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("promoteEdge — invalidation fires only after a successful promote response", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls both invalidate mocks exactly once each, after fetch resolves ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const utils = makeUtils();
    const outcome = await promoteEdge(EDGE_ID, IMPORTER_ID, utils);

    expect(outcome.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/knowledge/edges/${EDGE_ID}/promote`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(utils.knowledge.byId.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.knowledge.graph.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.knowledge.expandNode.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does NOT invalidate when the fetch response is !ok — the error branch returns early", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Edge not found" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const utils = makeUtils();
    const outcome = await promoteEdge(EDGE_ID, IMPORTER_ID, utils);

    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toBe("Edge not found");
    expect(utils.knowledge.byId.invalidate).not.toHaveBeenCalled();
    expect(utils.knowledge.graph.invalidate).not.toHaveBeenCalled();
    expect(utils.knowledge.expandNode.invalidate).not.toHaveBeenCalled();
  });

  it("falls back to a default error message when the !ok response body has no error field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const utils = makeUtils();
    const outcome = await promoteEdge(EDGE_ID, IMPORTER_ID, utils);

    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toBe("This suggestion could not be promoted.");
    expect(utils.knowledge.byId.invalidate).not.toHaveBeenCalled();
    expect(utils.knowledge.graph.invalidate).not.toHaveBeenCalled();
    expect(utils.knowledge.expandNode.invalidate).not.toHaveBeenCalled();
  });
});
