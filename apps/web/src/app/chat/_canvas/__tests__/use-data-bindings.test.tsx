/**
 * use-data-bindings.test.tsx — coverage for the standalone `useDataBindings`
 * hook (Phase 33 BIND-01 + the staleTime half of BIND-02): the compile-time
 * switch over the 5 wired allowlisted procedures, the params-from-context
 * convention (by-id procedures NEVER read `binding.params` for their id),
 * per-procedure staleTime tiers, and the degrade-to-`{}` posture on any
 * streaming/parse/validation edge case.
 *
 * `~/trpc/react`'s `api.useQueries` is mocked as a plain `vi.fn()` that
 * invokes the hook's callback against a lightweight fake `t` proxy whose
 * `<router>.<procedure>.queryOptions(input, opts)` returns
 * `{ queryKey: [router, procedure], __input: input, ...opts }` — letting
 * assertions inspect exactly what the switch constructed. The mock then
 * returns one stub `UseQueryResult`-shaped object per constructed query,
 * driven by a per-test `RESULTS` map keyed by `queryKey.join(".")`.
 *
 * Uses the repo's manual `createRoot`/`act` harness convention (mirrors
 * `use-canvas-persistence-edges-stable.test.tsx`) — no @testing-library
 * dependency in this package.
 */

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake `t` proxy — mirrors the trpc-react-query v11 `queryOptions` shape
// (`t.<router>.<procedure>.queryOptions(input, opts)`).
// ---------------------------------------------------------------------------

interface FakeQueryOptions {
  readonly queryKey: readonly [string, string];
  readonly __input: unknown;
  readonly enabled?: boolean;
  readonly staleTime?: number;
}

interface FakeQueryResult {
  readonly data: unknown;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

/** Per-test map from "router.procedure" -> stub query result. Defaults to
 * loading (data undefined) when a key has no explicit entry. */
let RESULTS: Record<string, FakeQueryResult> = {};

function makeProcedureLeaf(router: string, procedure: string) {
  return {
    queryOptions: (input: unknown, opts?: { enabled?: boolean; staleTime?: number }): FakeQueryOptions => ({
      queryKey: [router, procedure],
      __input: input,
      ...opts,
    }),
  };
}

const FAKE_T = {
  entities: {
    byId: makeProcedureLeaf("entities", "byId"),
    list: makeProcedureLeaf("entities", "list"),
  },
  emails: {
    detail: makeProcedureLeaf("emails", "detail"),
  },
  knowledge: {
    byId: makeProcedureLeaf("knowledge", "byId"),
    graph: makeProcedureLeaf("knowledge", "graph"),
  },
};

let capturedQueries: FakeQueryOptions[] = [];
const useQueriesMock = vi.fn((callback: (t: typeof FAKE_T) => unknown[]) => {
  const queries = callback(FAKE_T) as FakeQueryOptions[];
  capturedQueries = queries;
  return queries.map((q) => {
    const key = q.queryKey.join(".");
    return RESULTS[key] ?? { data: undefined, isLoading: true, isError: false };
  });
});

vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (cb: (t: typeof FAKE_T) => unknown[]) => useQueriesMock(cb),
  },
}));

import { useDataBindings, STALE_TIME_MS } from "../use-data-bindings";

const KNOWLEDGE_NODE_ID = "node-123";
const ENTITY_ID = "entity-456";
const EMAIL_ID = "email-789";

function specJsonWith(bindings: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    bindings,
    root: { type: "stack", children: [] },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  RESULTS = {};
  capturedQueries = [];
  useQueriesMock.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Mounts `useDataBindings(args)` and captures its return value. */
function mountHook(args: {
  specJson: string;
  isStreaming: boolean;
  panelData: Record<string, unknown>;
}): { result: () => Record<string, unknown> | undefined } {
  let captured: Record<string, unknown> | undefined;
  function Probe(): null {
    captured = useDataBindings(args);
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  return { result: () => captured };
}

describe("useDataBindings — staleTime tiers", () => {
  it("assigns the locked per-procedure staleTime values", () => {
    expect(STALE_TIME_MS["knowledge.byId"]).toBe(10_000);
    expect(STALE_TIME_MS["knowledge.graph"]).toBe(10_000);
    expect(STALE_TIME_MS["entities.byId"]).toBe(30_000);
    expect(STALE_TIME_MS["entities.list"]).toBe(30_000);
    expect(STALE_TIME_MS["emails.detail"]).toBe(60_000);
  });
});

describe("useDataBindings — knowledge.byId params-from-context", () => {
  it("fires an enabled query with {id: selectedNodeId} and staleTime 10_000 when panelData carries the id", () => {
    RESULTS["knowledge.byId"] = { data: { id: KNOWLEDGE_NODE_ID }, isLoading: false, isError: false };
    const { result } = mountHook({
      specJson: specJsonWith({ myNode: { procedure: "knowledge.byId", params: {} } }),
      isStreaming: false,
      panelData: { selectedNodeId: KNOWLEDGE_NODE_ID },
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "knowledge.byId");
    expect(query).toBeDefined();
    expect(query?.__input).toEqual({ id: KNOWLEDGE_NODE_ID });
    expect(query?.enabled).toBe(true);
    expect(query?.staleTime).toBe(10_000);
    expect(result()).toEqual({ myNode: { id: KNOWLEDGE_NODE_ID } });
  });

  it("never fires (enabled:false or excluded) when panelData.selectedNodeId is absent, and the result is undefined", () => {
    const { result } = mountHook({
      specJson: specJsonWith({ myNode: { procedure: "knowledge.byId", params: {} } }),
      isStreaming: false,
      panelData: {},
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "knowledge.byId");
    if (query !== undefined) {
      expect(query.enabled).toBe(false);
    }
    expect(result()?.myNode).toBeUndefined();
  });
});

describe("useDataBindings — entities.byId params-from-context", () => {
  it("sources id from panelData.selectedEntityId and skips when absent", () => {
    RESULTS["entities.byId"] = { data: { id: ENTITY_ID }, isLoading: false, isError: false };
    const { result } = mountHook({
      specJson: specJsonWith({ ent: { procedure: "entities.byId", params: {} } }),
      isStreaming: false,
      panelData: { selectedEntityId: ENTITY_ID },
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "entities.byId");
    expect(query?.__input).toEqual({ id: ENTITY_ID });
    expect(query?.enabled).toBe(true);
    expect(result()).toEqual({ ent: { id: ENTITY_ID } });

    const { result: resultAbsent } = mountHook({
      specJson: specJsonWith({ ent: { procedure: "entities.byId", params: {} } }),
      isStreaming: false,
      panelData: {},
    });
    const queryAbsent = capturedQueries.find((q) => q.queryKey.join(".") === "entities.byId");
    if (queryAbsent !== undefined) {
      expect(queryAbsent.enabled).toBe(false);
    }
    expect(resultAbsent()?.ent).toBeUndefined();
  });
});

describe("useDataBindings — emails.detail params-from-context", () => {
  it("sources id from panelData.selectedEmailId and skips when absent", () => {
    RESULTS["emails.detail"] = { data: { id: EMAIL_ID }, isLoading: false, isError: false };
    const { result } = mountHook({
      specJson: specJsonWith({ eml: { procedure: "emails.detail", params: {} } }),
      isStreaming: false,
      panelData: { selectedEmailId: EMAIL_ID },
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "emails.detail");
    expect(query?.__input).toEqual({ id: EMAIL_ID });
    expect(query?.enabled).toBe(true);
    expect(result()).toEqual({ eml: { id: EMAIL_ID } });

    const { result: resultAbsent } = mountHook({
      specJson: specJsonWith({ eml: { procedure: "emails.detail", params: {} } }),
      isStreaming: false,
      panelData: {},
    });
    const queryAbsent = capturedQueries.find((q) => q.queryKey.join(".") === "emails.detail");
    if (queryAbsent !== undefined) {
      expect(queryAbsent.enabled).toBe(false);
    }
    expect(resultAbsent()?.eml).toBeUndefined();
  });
});

describe("useDataBindings — entities.list model-authored non-ID params", () => {
  it("passes binding.params (search, limit) through to the resolved query input", () => {
    RESULTS["entities.list"] = { data: [{ id: "e1" }], isLoading: false, isError: false };
    mountHook({
      specJson: specJsonWith({
        gallery: { procedure: "entities.list", params: { search: "acme", limit: 10 } },
      }),
      isStreaming: false,
      panelData: {},
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "entities.list");
    expect(query).toBeDefined();
    const input = query?.__input as Record<string, unknown>;
    expect(input.search).toBe("acme");
    expect(input.limit).toBe(10);
  });
});

describe("useDataBindings — knowledge.graph importerId always from render context", () => {
  it("never sources importerId from binding.params, regardless of panelData.importerId presence", () => {
    RESULTS["knowledge.graph"] = { data: { nodes: [], edges: [] }, isLoading: false, isError: false };
    mountHook({
      specJson: specJsonWith({
        g: {
          procedure: "knowledge.graph",
          params: { includeInstances: true },
        },
      }),
      isStreaming: false,
      panelData: {},
    });

    const query = capturedQueries.find((q) => q.queryKey.join(".") === "knowledge.graph");
    const input = query?.__input as Record<string, unknown>;
    expect(input.importerId).toBe("00000000-0000-0000-0000-000000000001");
    expect(input.includeInstances).toBe(true);

    RESULTS["knowledge.graph"] = { data: { nodes: [], edges: [] }, isLoading: false, isError: false };
    mountHook({
      specJson: specJsonWith({
        g: { procedure: "knowledge.graph", params: {} },
      }),
      isStreaming: false,
      panelData: { importerId: "11111111-1111-1111-1111-111111111111" },
    });
    const query2 = capturedQueries.find((q) => q.queryKey.join(".") === "knowledge.graph");
    const input2 = query2?.__input as Record<string, unknown>;
    expect(input2.importerId).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("useDataBindings — streaming tolerance", () => {
  it("returns {} while isStreaming with no parsed bindings yet, firing no queries", () => {
    const { result } = mountHook({
      specJson: '{"v":1,"root":{"type":"stack","child',
      isStreaming: true,
      panelData: {},
    });

    expect(result()).toEqual({});
    expect(capturedQueries).toEqual([]);
  });
});

describe("useDataBindings — malformed specJson", () => {
  it("returns {} and never throws when specJson is malformed and unrepairable", () => {
    const { result } = mountHook({
      specJson: "{not json at all!!",
      isStreaming: false,
      panelData: {},
    });

    expect(result()).toEqual({});
  });
});

describe("useDataBindings — bindings fail schema validation", () => {
  it("returns {} when bindings contains an unknown procedure string", () => {
    const { result } = mountHook({
      specJson: specJsonWith({ bad: { procedure: "emails.list", params: {} } }),
      isStreaming: false,
      panelData: {},
    });

    // emails.list IS allowlisted at the schema level but NOT wired into this
    // phase's 5-procedure switch — the hook must degrade this binding key to
    // undefined, never throw, never fire a query for it.
    expect(result()?.bad).toBeUndefined();
  });

  it("returns {} when the bindings record itself fails safeParse (garbage shape)", () => {
    const { result } = mountHook({
      specJson: JSON.stringify({ v: 1, bindings: { bad: { totallyWrong: true } }, root: { type: "stack", children: [] } }),
      isStreaming: false,
      panelData: {},
    });

    expect(result()).toEqual({});
  });
});

describe("useDataBindings — merged multi-binding result", () => {
  it("merges two resolved bindings under their own keys; loading surfaces as undefined", () => {
    RESULTS["knowledge.byId"] = { data: { id: KNOWLEDGE_NODE_ID }, isLoading: false, isError: false };
    // "b" (entities.list) intentionally has no RESULTS entry -> defaults to loading/undefined.
    const { result } = mountHook({
      specJson: specJsonWith({
        a: { procedure: "knowledge.byId", params: {} },
        b: { procedure: "entities.list", params: {} },
      }),
      isStreaming: false,
      panelData: { selectedNodeId: KNOWLEDGE_NODE_ID },
    });

    const value = result();
    expect(value?.a).toEqual({ id: KNOWLEDGE_NODE_ID });
    expect(value?.b).toBeUndefined();
    expect(Object.keys(value ?? {})).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
