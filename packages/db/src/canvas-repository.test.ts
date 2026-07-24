/**
 * canvas-repository.test.ts — the Track 3b B2 gate for the single row-model write
 * path (canvas-repository.ts).
 *
 * DB-free, mirroring the ownership.test.ts / canvas-mutations.test.ts idiom: a
 * fake thenable Drizzle-chain stub identifies the target table by object identity
 * (=== Canvases / CanvasNodes / CanvasEdges), returns seeded rows for selects, and
 * RECORDS every insert/upsert/delete/update. Transactions call the callback with
 * the same handle.
 *
 * The "round-trip" is exercised end-to-end WITHOUT a stateful SQL engine: run
 * applySnapshot, capture the per-node/edge upsert rows + the canvas stamp, then
 * feed those exact rows into assembleSnapshot and assert the reconstructed
 * snapshot logically equals the input — proving snapshot -> rows (apply) and rows
 * -> snapshot (assemble) both preserve all 13 node types, the `unknown-node-type`
 * heal path, and the two content-carrying types (`source`, `directory`).
 *
 * Test plan:
 *   assemble 1: null when the canvas row is absent.
 *   assemble 2: rows -> a well-formed CanvasSnapshot (viewport/sharedState/version).
 *   apply 1: parse is called FIRST — a throwing parse writes nothing.
 *   apply 2: node/edge cap exceeded -> CanvasRepositoryError, nothing written.
 *   apply 3: diff deletes dropped rows and upserts kept ones; canvas row stamped.
 *   round-trip: 14-node snapshot (13 types + unknown-node-type + source/directory
 *               content) survives apply -> assemble byte-for-byte (logical eq).
 *   addNode 1: new canonical key inserts (created:true).
 *   addNode 2: existing canonical key is an idempotent no-op (created:false, NO insert).
 *   addNode 3: a full canvas (MAX_CANVAS_NODES) refuses (CAP_EXCEEDED, NO insert).
 *   connect 1: inserts a deterministic edge_key (created:true).
 *   connect 2: identical wiring is an idempotent no-op (created:false, NO insert).
 *   connect 3: a missing endpoint -> ENDPOINT_MISSING, NO insert.
 *   removeNode 1: removes the node AND its edges in the transaction; returns undo payload.
 *   removeNode 2: a missing key is an idempotent no-op (removed:false, NO delete).
 */

import { describe, expect, it } from "vitest";

import {
  addNode,
  applySnapshot,
  assembleSnapshot,
  canonicalEdgeKey,
  canonicalNodeId,
  CanvasRepositoryError,
  connect,
  MAX_CANVAS_NODES,
  removeNode,
  type CanvasRepositoryDb,
  type CanvasSnapshot,
  type CanvasSnapshotNode,
} from "./canvas-repository";
import { CanvasEdges } from "./schema/canvas-edges";
import { CanvasNodes } from "./schema/canvas-nodes";
import { Canvases } from "./schema/canvases";

const CANVAS_ID = "40000000-0000-0000-0000-000000000001";
const CONVERSATION_ID = "20000000-0000-0000-0000-000000000c01";

type Row = Record<string, unknown>;
type Seed = {
  canvases?: Row[];
  canvasNodes?: Row[];
  canvasEdges?: Row[];
};

type InsertRec = { table: string; values: Row; set?: Row };
type UpdateRec = { table: string; set: Row };

function tableKey(t: unknown): "canvases" | "canvasNodes" | "canvasEdges" | "?" {
  if (t === Canvases) return "canvases";
  if (t === CanvasNodes) return "canvasNodes";
  if (t === CanvasEdges) return "canvasEdges";
  return "?";
}

function createFakeDb(seed: Seed = {}) {
  const inserts: InsertRec[] = [];
  const updates: UpdateRec[] = [];
  const deletes: { table: string }[] = [];

  const rowsFor = (t: unknown): Row[] => {
    const key = tableKey(t);
    if (key === "canvases") return seed.canvases ?? [];
    if (key === "canvasNodes") return seed.canvasNodes ?? [];
    if (key === "canvasEdges") return seed.canvasEdges ?? [];
    return [];
  };

  const handle: Record<string, unknown> = {
    select() {
      let table: unknown;
      const chain: Record<string, unknown> = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        then(onF: (rows: Row[]) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve(rowsFor(table)).then(onF, onR);
        },
      };
      return chain;
    },
    insert(t: unknown) {
      const rec: InsertRec = { table: tableKey(t), values: {} };
      const chain: Record<string, unknown> = {
        values(v: Row) {
          rec.values = v;
          return chain;
        },
        onConflictDoUpdate(cfg: { set: Row }) {
          rec.set = cfg.set;
          return chain;
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          inserts.push(rec);
          return Promise.resolve(undefined).then(onF, onR);
        },
      };
      return chain;
    },
    update(t: unknown) {
      const rec: UpdateRec = { table: tableKey(t), set: {} };
      const chain: Record<string, unknown> = {
        set(s: Row) {
          rec.set = s;
          return chain;
        },
        where() {
          return chain;
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          updates.push(rec);
          return Promise.resolve(undefined).then(onF, onR);
        },
      };
      return chain;
    },
    delete(t: unknown) {
      const rec = { table: tableKey(t) };
      const chain: Record<string, unknown> = {
        where() {
          return chain;
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          deletes.push(rec);
          return Promise.resolve(undefined).then(onF, onR);
        },
      };
      return chain;
    },
    transaction(cb: (tx: unknown) => unknown) {
      return cb(handle);
    },
  };

  return {
    db: handle as unknown as CanvasRepositoryDb,
    inserts,
    updates,
    deletes,
    nodeInserts: () => inserts.filter((r) => r.table === "canvasNodes"),
    edgeInserts: () => inserts.filter((r) => r.table === "canvasEdges"),
  };
}

const identityParse = (raw: unknown): CanvasSnapshot => raw as CanvasSnapshot;

/** A node row (the DB shape assembleSnapshot reads) built from an insert `values`. */
function rowFromInsert(values: Row): Row {
  return {
    nodeKey: values.nodeKey,
    type: values.type,
    position: values.position,
    width: values.width ?? null,
    height: values.height ?? null,
    data: values.data,
  };
}

function edgeRowFromInsert(values: Row): Row {
  return {
    edgeKey: values.edgeKey,
    sourceKey: values.sourceKey,
    targetKey: values.targetKey,
    data: values.data,
  };
}

function sortById<T extends { id: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// The 13-type + heal + content fixture
// ---------------------------------------------------------------------------

function thirteenTypeSnapshot(): CanvasSnapshot {
  const nodes: CanvasSnapshotNode[] = [
    { id: `chat:${CONVERSATION_ID}`, type: "chat", position: { x: 0, y: 0 }, data: { conversationId: CONVERSATION_ID } },
    {
      id: "genui-panel:msg-1:0",
      type: "genui-panel",
      position: { x: 10, y: 10 },
      width: 400,
      height: 300,
      data: { provenance: { messageId: "msg-1", partIndex: 0, runId: null }, turnIndex: 2 },
    },
    { id: "knowledge-preview:kn-1", type: "knowledge-preview", position: { x: 20, y: 20 }, data: { focusNodeId: "kn-1", label: "K" } },
    { id: "email-thread:th-1", type: "email-thread", position: { x: 30, y: 30 }, data: { threadId: "th-1", label: "Renewal" } },
    { id: "document:doc-1", type: "document", position: { x: 40, y: 40 }, data: { documentId: "doc-1", label: "Brief" } },
    {
      // content-carrying #1 — inline display payload rides in data (D-05 exception).
      id: "source:led-1",
      type: "source",
      position: { x: 50, y: 50 },
      data: {
        sourceLedgerId: "led-1",
        url: "https://example.com/x",
        title: "A source",
        excerpt: "an excerpt",
        tier: "suggested",
      },
    },
    {
      // content-carrying #2 — bounded entries preview rides in data.
      id: "directory:/home/u",
      type: "directory",
      position: { x: 60, y: 60 },
      data: { path: "/home/u", label: "home", entries: [{ name: "a.txt", kind: "file" }, { name: "sub", kind: "dir" }] },
    },
    { id: "browser:b-1", type: "browser", position: { x: 70, y: 70 }, data: { url: "https://ex.com", label: "web" } },
    { id: "editor:e-1", type: "editor", position: { x: 80, y: 80 }, data: { filePath: "a.ts", label: "a.ts", language: "ts" } },
    { id: "desktop:d-1", type: "desktop", position: { x: 90, y: 90 }, data: { sessionId: "d-1", status: "running", label: "VM" } },
    { id: "circle-pack:c-1", type: "circle-pack", position: { x: 100, y: 100 }, data: { scope: "mailbox" } },
    { id: "spreadsheet:s-1", type: "spreadsheet", position: { x: 110, y: 110 }, data: { spreadsheetId: "s-1", label: "Sheet" } },
    { id: "file:f-1", type: "file", position: { x: 120, y: 120 }, data: { path: ["docs"], name: "r.pdf", label: "r.pdf" } },
    {
      // heal path — a type this session's registry does NOT recognize, with its
      // ORIGINAL type/data preserved so a future registry addition can heal it.
      id: "future-widget:w-1",
      type: "unknown-node-type",
      position: { x: 130, y: 130 },
      data: { __originalType: "future-widget", widgetRef: "w-1", nested: { deep: [1, 2, 3] } },
    },
  ];
  const edges = [
    { id: "edge:1", source: `chat:${CONVERSATION_ID}`, target: "document:doc-1", data: { sourcePath: "data.result", targetKey: "input" } },
    { id: "edge:2", source: "source:led-1", target: "genui-panel:msg-1:0", data: { sourcePath: "data", targetKey: "input" } },
  ];
  return {
    nodes,
    edges,
    viewport: { x: 5, y: 6, zoom: 1.25 },
    sharedState: { "shared.count": 3, "panels.p1.open": true, "home.panels": [{ id: "x" }] },
    nodeRegistryVersion: "hash-abc",
  };
}

// ---------------------------------------------------------------------------
// assembleSnapshot
// ---------------------------------------------------------------------------

describe("assembleSnapshot", () => {
  it("assemble 1: returns null when the canvas row is absent", async () => {
    const fake = createFakeDb({ canvases: [] });
    expect(await assembleSnapshot(fake.db, CANVAS_ID)).toBeNull();
  });

  it("assemble 2: maps rows into a well-formed CanvasSnapshot", async () => {
    const fake = createFakeDb({
      canvases: [
        {
          id: CANVAS_ID,
          viewport: { x: 1, y: 2, zoom: 3 },
          sharedState: { "shared.k": 1 },
          nodeRegistryVersion: "v9",
        },
      ],
      canvasNodes: [
        { nodeKey: "chat:c", type: "chat", position: { x: 0, y: 0 }, width: null, height: null, data: { conversationId: "c" } },
        { nodeKey: "document:d", type: "document", position: { x: 9, y: 9 }, width: 400, height: 250, data: { documentId: "d" } },
      ],
      canvasEdges: [
        { edgeKey: "edge:1", sourceKey: "chat:c", targetKey: "document:d", data: { sourcePath: "data", targetKey: "input" } },
      ],
    });

    const snap = await assembleSnapshot(fake.db, CANVAS_ID);
    expect(snap).not.toBeNull();
    expect(snap!.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(snap!.sharedState).toEqual({ "shared.k": 1 });
    expect(snap!.nodeRegistryVersion).toBe("v9");
    expect(snap!.nodes).toHaveLength(2);
    // width/height omitted when null; included when present.
    const chat = snap!.nodes.find((n) => n.id === "chat:c")!;
    expect("width" in chat).toBe(false);
    const doc = snap!.nodes.find((n) => n.id === "document:d")!;
    expect(doc.width).toBe(400);
    expect(doc.height).toBe(250);
    expect(snap!.edges).toEqual([
      { id: "edge:1", source: "chat:c", target: "document:d", data: { sourcePath: "data", targetKey: "input" } },
    ]);
  });

  it("assemble: falls back to the sentinel registry version when the row has none", async () => {
    const fake = createFakeDb({
      canvases: [{ id: CANVAS_ID, viewport: null, sharedState: {}, nodeRegistryVersion: null }],
      canvasNodes: [],
      canvasEdges: [],
    });
    const snap = await assembleSnapshot(fake.db, CANVAS_ID);
    expect(snap!.nodeRegistryVersion).toBe("agent-canvas-mutation:v1");
    expect("viewport" in snap!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applySnapshot
// ---------------------------------------------------------------------------

describe("applySnapshot", () => {
  it("apply 1: parse is called FIRST — a throwing parse writes nothing", async () => {
    const fake = createFakeDb();
    const boom = () => {
      throw new Error("parse rejected");
    };
    await expect(
      applySnapshot(fake.db, CANVAS_ID, { nodes: [] }, boom),
    ).rejects.toThrow("parse rejected");
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
    expect(fake.deletes).toHaveLength(0);
  });

  it("apply 2: exceeding the node cap throws CAP_EXCEEDED with no write", async () => {
    const fake = createFakeDb();
    const tooMany: CanvasSnapshot = {
      nodes: Array.from({ length: MAX_CANVAS_NODES + 1 }, (_, i) => ({
        id: `n-${i}`,
        type: "chat",
        position: { x: i, y: i },
        data: {},
      })),
      edges: [],
      sharedState: {},
      nodeRegistryVersion: "v",
    };
    await expect(
      applySnapshot(fake.db, CANVAS_ID, tooMany, identityParse),
    ).rejects.toMatchObject({ code: "CAP_EXCEEDED" });
    expect(fake.inserts).toHaveLength(0);
  });

  it("apply 3: diffs (delete dropped + upsert kept) and stamps the canvas row", async () => {
    const fake = createFakeDb();
    const snapshot: CanvasSnapshot = {
      nodes: [
        { id: "chat:c", type: "chat", position: { x: 1, y: 2 }, data: { conversationId: "c" } },
        { id: "document:d", type: "document", position: { x: 3, y: 4 }, width: 400, data: { documentId: "d" } },
      ],
      edges: [{ id: "edge:1", source: "chat:c", target: "document:d", data: { sourcePath: "p", targetKey: "k" } }],
      viewport: { x: 0, y: 0, zoom: 1 },
      sharedState: { "shared.n": 9 },
      nodeRegistryVersion: "vX",
    };
    await applySnapshot(fake.db, CANVAS_ID, snapshot, identityParse);

    // deletes of dropped rows (nodes + edges), one canvas stamp, two node upserts + one edge upsert.
    expect(fake.deletes.map((d) => d.table).sort()).toEqual(["canvasEdges", "canvasNodes"]);
    expect(fake.nodeInserts()).toHaveLength(2);
    expect(fake.edgeInserts()).toHaveLength(1);
    const nodeUpsert = fake.nodeInserts()[1]!;
    expect(nodeUpsert.values).toMatchObject({ canvasId: CANVAS_ID, nodeKey: "document:d", type: "document", width: 400 });
    expect(nodeUpsert.set).toMatchObject({ type: "document", width: 400 });
    const stamp = fake.updates.find((u) => u.table === "canvases")!;
    expect(stamp.set).toMatchObject({
      viewport: { x: 0, y: 0, zoom: 1 },
      sharedState: { "shared.n": 9 },
      nodeRegistryVersion: "vX",
    });
    expect(stamp.set.updatedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: apply -> assemble preserves all 13 types + heal + source/directory
// ---------------------------------------------------------------------------

describe("round-trip (apply -> assemble)", () => {
  it("preserves 13 node types + unknown-node-type heal + source/directory content", async () => {
    const input = thirteenTypeSnapshot();

    const writeFake = createFakeDb();
    await applySnapshot(writeFake.db, CANVAS_ID, input, identityParse);

    // Pipe the captured upsert rows straight back into assemble's seed — a true
    // snapshot -> rows -> snapshot round-trip with no stateful SQL engine.
    const nodeRows = writeFake.nodeInserts().map((r) => rowFromInsert(r.values));
    const edgeRows = writeFake.edgeInserts().map((r) => edgeRowFromInsert(r.values));
    const stamp = writeFake.updates.find((u) => u.table === "canvases")!.set;

    const readFake = createFakeDb({
      canvases: [
        {
          id: CANVAS_ID,
          viewport: stamp.viewport,
          sharedState: stamp.sharedState,
          nodeRegistryVersion: stamp.nodeRegistryVersion,
        },
      ],
      canvasNodes: nodeRows,
      canvasEdges: edgeRows,
    });

    const out = await assembleSnapshot(readFake.db, CANVAS_ID);
    expect(out).not.toBeNull();

    // Logical equality (order-insensitive — positions are absolute).
    expect(sortById(out!.nodes)).toEqual(sortById(input.nodes));
    expect(sortById(out!.edges)).toEqual(sortById(input.edges));
    expect(out!.viewport).toEqual(input.viewport);
    expect(out!.sharedState).toEqual(input.sharedState);
    expect(out!.nodeRegistryVersion).toBe(input.nodeRegistryVersion);

    // Spot-check the two content-carrying types kept their inline payload.
    const source = out!.nodes.find((n) => n.id === "source:led-1")!;
    expect(source.data).toMatchObject({ url: "https://example.com/x", title: "A source", excerpt: "an excerpt" });
    const directory = out!.nodes.find((n) => n.id === "directory:/home/u")!;
    expect((directory.data.entries as unknown[]).length).toBe(2);

    // Spot-check the heal path — unknown type + original data intact.
    const healed = out!.nodes.find((n) => n.id === "future-widget:w-1")!;
    expect(healed.type).toBe("unknown-node-type");
    expect(healed.data).toMatchObject({ __originalType: "future-widget", nested: { deep: [1, 2, 3] } });
  });
});

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe("addNode", () => {
  it("addNode 1: a new canonical key inserts (created:true)", async () => {
    const fake = createFakeDb({ canvasNodes: [] });
    const res = await addNode(fake.db, CANVAS_ID, "email-thread", { threadId: "th-9" });
    expect(res).toEqual({ nodeKey: "email-thread:th-9", nodeType: "email-thread", created: true });
    expect(fake.nodeInserts()).toHaveLength(1);
    expect(fake.nodeInserts()[0]!.values).toMatchObject({
      canvasId: CANVAS_ID,
      nodeKey: "email-thread:th-9",
      type: "email-thread",
      data: { threadId: "th-9" },
    });
  });

  it("addNode 2: an existing canonical key is an idempotent no-op (NO insert)", async () => {
    const fake = createFakeDb({
      canvasNodes: [{ nodeKey: "email-thread:th-9", type: "email-thread", position: { x: 0, y: 0 }, height: null }],
    });
    const res = await addNode(fake.db, CANVAS_ID, "email-thread", { threadId: "th-9" });
    expect(res).toEqual({ nodeKey: "email-thread:th-9", nodeType: "email-thread", created: false });
    expect(fake.inserts).toHaveLength(0);
  });

  it("addNode 3: a full canvas refuses the add (CAP_EXCEEDED, NO insert)", async () => {
    const fake = createFakeDb({
      canvasNodes: Array.from({ length: MAX_CANVAS_NODES }, (_, i) => ({
        nodeKey: `chat:filler-${i}`,
        type: "chat",
        position: { x: i, y: i },
        height: null,
      })),
    });
    await expect(
      addNode(fake.db, CANVAS_ID, "email-thread", { threadId: "th-9" }),
    ).rejects.toMatchObject({ code: "CAP_EXCEEDED" });
    expect(fake.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe("connect", () => {
  const nodes = [
    { nodeKey: "chat:c" },
    { nodeKey: "document:d" },
  ];

  it("connect 1: inserts a deterministic edge_key (created:true)", async () => {
    const fake = createFakeDb({ canvasNodes: nodes, canvasEdges: [] });
    const res = await connect(fake.db, CANVAS_ID, "chat:c", "document:d", "data", "input");
    expect(res.created).toBe(true);
    expect(res.edgeKey).toBe(canonicalEdgeKey("chat:c", "document:d", "data", "input"));
    expect(fake.edgeInserts()).toHaveLength(1);
    expect(fake.edgeInserts()[0]!.values).toMatchObject({
      canvasId: CANVAS_ID,
      sourceKey: "chat:c",
      targetKey: "document:d",
      data: { sourcePath: "data", targetKey: "input" },
    });
  });

  it("connect 2: identical wiring is an idempotent no-op (created:false, NO insert)", async () => {
    const edgeKey = canonicalEdgeKey("chat:c", "document:d", "data", "input");
    const fake = createFakeDb({ canvasNodes: nodes, canvasEdges: [{ edgeKey }] });
    const res = await connect(fake.db, CANVAS_ID, "chat:c", "document:d", "data", "input");
    expect(res).toEqual({ edgeKey, created: false });
    expect(fake.inserts).toHaveLength(0);
  });

  it("connect 3: a missing endpoint rejects (ENDPOINT_MISSING, NO insert)", async () => {
    const fake = createFakeDb({ canvasNodes: nodes, canvasEdges: [] });
    await expect(
      connect(fake.db, CANVAS_ID, "chat:c", "does-not-exist", "data", "input"),
    ).rejects.toMatchObject({ code: "ENDPOINT_MISSING" });
    expect(fake.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe("removeNode", () => {
  it("removeNode 1: removes the node AND its edges, returns the undo payload", async () => {
    const node = {
      nodeKey: "document:d",
      type: "document",
      position: { x: 3, y: 4 },
      width: null,
      height: null,
      data: { documentId: "d" },
    };
    const detached = [
      { edgeKey: "edge:1", sourceKey: "chat:c", targetKey: "document:d", data: { sourcePath: "p", targetKey: "k" } },
    ];
    const fake = createFakeDb({ canvasNodes: [node], canvasEdges: detached });

    const res = await removeNode(fake.db, CANVAS_ID, "document:d");
    expect(res.removed).toBe(true);
    expect(res.node).toEqual({ id: "document:d", type: "document", position: { x: 3, y: 4 }, data: { documentId: "d" } });
    expect(res.detachedEdges).toEqual([
      { id: "edge:1", source: "chat:c", target: "document:d", data: { sourcePath: "p", targetKey: "k" } },
    ]);
    // one delete on edges + one delete on nodes (both inside the transaction).
    expect(fake.deletes.map((d) => d.table).sort()).toEqual(["canvasEdges", "canvasNodes"]);
  });

  it("removeNode 2: a missing key is an idempotent no-op (removed:false, NO delete)", async () => {
    const fake = createFakeDb({ canvasNodes: [] });
    const res = await removeNode(fake.db, CANVAS_ID, "nope");
    expect(res).toEqual({ removed: false, node: null, detachedEdges: [] });
    expect(fake.deletes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// canonical key helpers
// ---------------------------------------------------------------------------

describe("canonical keys", () => {
  it("canonicalNodeId mirrors the type:ref scheme for ref-anchored types", () => {
    expect(canonicalNodeId("chat", { conversationId: CONVERSATION_ID })).toBe(`chat:${CONVERSATION_ID}`);
    expect(canonicalNodeId("document", { documentId: "d1" })).toBe("document:d1");
    expect(canonicalNodeId("source", { sourceLedgerId: "led" })).toBe("source:led");
    expect(
      canonicalNodeId("genui-panel", { provenance: { messageId: "m", partIndex: 2 } }),
    ).toBe("genui-panel:m:2");
  });

  it("canonicalEdgeKey is deterministic in its wiring tuple", () => {
    expect(canonicalEdgeKey("a", "b", "p", "k")).toBe(canonicalEdgeKey("a", "b", "p", "k"));
    expect(canonicalEdgeKey("a", "b", "p", "k")).not.toBe(canonicalEdgeKey("a", "b", "p", "k2"));
  });

  it("CanvasRepositoryError carries a mappable code", () => {
    expect(new CanvasRepositoryError("CAP_EXCEEDED", "x").code).toBe("CAP_EXCEEDED");
  });
});
