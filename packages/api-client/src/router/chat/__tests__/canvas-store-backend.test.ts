/**
 * canvas-store-backend.test.ts — Track 3b B3 gate for the CANVAS_ROW_MODEL flag +
 * the BlobStore/RowStore backends behind the seven unchanged canvas procedures.
 *
 * DB-free (ownership/canvas-mutations idiom): a fake thenable Drizzle chain
 * identifies the target table by object identity, returns seeded rows for selects,
 * resolves `.returning()` inserts to a fixed id, and RECORDS every blob upsert /
 * row upsert / canvas stamp / delete. The "round-trip" pipes the captured row
 * upserts back through assemble (via readConversationRow), no stateful SQL engine.
 *
 * Test plan (the B3 gate):
 *   flag: canvasRowMode() parses off/dual_write/read_rows; unknown => off.
 *   off:  writeCanvasLayout writes ONLY the blob (no canvas/node/edge rows).
 *   (a)   dual_write leaves the blob upsert byte-identical to the off path.
 *   dual: dual_write ALSO auto-creates the workspace+canvas and upserts rows.
 *   (b)   RowStore round-trips all 13 node types + unknown-node-type heal +
 *         source/directory content (writeConversationRow -> readConversationRow).
 *   (c)   shadow-compare: the snapshot reconstructed from rows == the blob snapshot.
 *   (d)   caps + write-time gates still reject hostile input on the row path
 *         (applySnapshot's injected CanvasSnapshotSchema.parse).
 *   read: read_rows reads from RowStore, falling back to the blob when no canvas.
 *   safe: a dual_write row-write failure is swallowed — the blob write still lands.
 *   home: the home board flows through the same off/dual/read backend.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Canvases,
  CanvasEdges,
  CanvasNodes,
  ChatCanvasLayouts,
  WorkspaceMembers,
  Workspaces,
} from "@polytoken/db/schema";

import { type CanvasSnapshot } from "../canvas-schema";
import {
  canvasRowMode,
  readCanvasLayout,
  readConversationRow,
  readHomeCanvasLayout,
  writeCanvasLayout,
  writeConversationRow,
  writeHomeCanvasLayout,
} from "../canvas-store-backend";

const CONVERSATION_ID = "20000000-0000-0000-0000-000000000c01";
const OWNER_ID = "10000000-0000-0000-0000-00000000000a";
const CANVAS_ID = "40000000-0000-0000-0000-000000000001";
const WORKSPACE_ID = "50000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-07-24T00:00:00.000Z");

type Row = Record<string, unknown>;
type InsertRec = { values: Row; set?: Row; returning: boolean; onConflictDoNothing?: boolean };
type Seed = {
  chatCanvasLayouts?: Row[];
  canvases?: Row[];
  canvasNodes?: Row[];
  canvasEdges?: Row[];
  workspaces?: Row[];
};

function tableKey(t: unknown): string {
  if (t === ChatCanvasLayouts) return "chatCanvasLayouts";
  if (t === Canvases) return "canvases";
  if (t === CanvasNodes) return "canvasNodes";
  if (t === CanvasEdges) return "canvasEdges";
  if (t === Workspaces) return "workspaces";
  if (t === WorkspaceMembers) return "workspaceMembers";
  return "?";
}

function createFakeDb(seed: Seed = {}, opts: { returningEmpty?: boolean } = {}) {
  const blobUpserts: InsertRec[] = [];
  const nodeUpserts: InsertRec[] = [];
  const edgeUpserts: InsertRec[] = [];
  const canvasInserts: InsertRec[] = [];
  const workspaceInserts: InsertRec[] = [];
  const memberInserts: InsertRec[] = [];
  const canvasStamps: { set: Row }[] = [];
  const deletes: { table: string }[] = [];

  const rowsFor = (t: unknown): Row[] => {
    const key = tableKey(t) as keyof Seed;
    return (seed[key] as Row[] | undefined) ?? [];
  };

  const handle: Record<string, unknown> = {
    select() {
      let table: unknown;
      const chain: Record<string, unknown> = {
        from(t: unknown) {
          table = t;
          return chain;
        },
        where: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        then(onF: (r: Row[]) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve(rowsFor(table)).then(onF, onR);
        },
      };
      return chain;
    },
    insert(t: unknown) {
      const key = tableKey(t);
      const rec: InsertRec = { values: {}, returning: false };
      const chain: Record<string, unknown> = {
        values(v: Row) {
          rec.values = v;
          return chain;
        },
        onConflictDoUpdate(cfg: { set: Row }) {
          rec.set = cfg.set;
          return chain;
        },
        onConflictDoNothing() {
          rec.onConflictDoNothing = true;
          return chain;
        },
        returning() {
          rec.returning = true;
          return chain;
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          if (key === "chatCanvasLayouts") blobUpserts.push(rec);
          else if (key === "canvasNodes") nodeUpserts.push(rec);
          else if (key === "canvasEdges") edgeUpserts.push(rec);
          else if (key === "canvases") canvasInserts.push(rec);
          else if (key === "workspaces") workspaceInserts.push(rec);
          else if (key === "workspaceMembers") memberInserts.push(rec);
          let result: unknown = undefined;
          if (rec.returning) {
            if (opts.returningEmpty) result = [];
            else result = [{ id: key === "workspaces" ? WORKSPACE_ID : CANVAS_ID }];
          }
          return Promise.resolve(result).then(onF, onR);
        },
      };
      return chain;
    },
    update() {
      const rec = { set: {} as Row };
      const chain: Record<string, unknown> = {
        set(s: Row) {
          rec.set = s;
          return chain;
        },
        where: () => chain,
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          canvasStamps.push(rec);
          return Promise.resolve(undefined).then(onF, onR);
        },
      };
      return chain;
    },
    delete(t: unknown) {
      const rec = { table: tableKey(t) };
      const chain: Record<string, unknown> = {
        where: () => chain,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: handle as any,
    blobUpserts,
    nodeUpserts,
    edgeUpserts,
    canvasInserts,
    workspaceInserts,
    memberInserts,
    canvasStamps,
    deletes,
  };
}

const rowFromInsert = (v: Row): Row => ({
  nodeKey: v.nodeKey,
  type: v.type,
  position: v.position,
  width: v.width ?? null,
  height: v.height ?? null,
  data: v.data,
});
const edgeRowFromInsert = (v: Row): Row => ({
  edgeKey: v.edgeKey,
  sourceKey: v.sourceKey,
  targetKey: v.targetKey,
  data: v.data,
});
const sortById = <T extends { id: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.id.localeCompare(b.id));

function snapshot13(): CanvasSnapshot {
  return {
    nodes: [
      { id: `chat:${CONVERSATION_ID}`, type: "chat", position: { x: 0, y: 0 }, data: { conversationId: CONVERSATION_ID } },
      {
        id: "genui-panel:msg-1:0",
        type: "genui-panel",
        position: { x: 10, y: 10 },
        width: 400,
        height: 300,
        data: { provenance: { messageId: "msg-1", partIndex: 0, runId: null }, turnIndex: 2 },
      },
      { id: "knowledge-preview:kn-1", type: "knowledge-preview", position: { x: 20, y: 20 }, data: { focusNodeId: "kn-1" } },
      { id: "email-thread:th-1", type: "email-thread", position: { x: 30, y: 30 }, data: { threadId: "th-1" } },
      { id: "document:doc-1", type: "document", position: { x: 40, y: 40 }, data: { documentId: "doc-1" } },
      { id: "source:led-1", type: "source", position: { x: 50, y: 50 }, data: { sourceLedgerId: "led-1", url: "https://ex.com/x", title: "S", excerpt: "e" } },
      { id: "directory:/home/u", type: "directory", position: { x: 60, y: 60 }, data: { path: "/home/u", entries: [{ name: "a" }, { name: "b" }] } },
      { id: "browser:b-1", type: "browser", position: { x: 70, y: 70 }, data: { url: "https://ex.com" } },
      { id: "editor:e-1", type: "editor", position: { x: 80, y: 80 }, data: { filePath: "a.ts" } },
      { id: "desktop:d-1", type: "desktop", position: { x: 90, y: 90 }, data: { sessionId: "d-1" } },
      { id: "circle-pack:c-1", type: "circle-pack", position: { x: 100, y: 100 }, data: { scope: "mailbox" } },
      { id: "spreadsheet:s-1", type: "spreadsheet", position: { x: 110, y: 110 }, data: { spreadsheetId: "s-1" } },
      { id: "file:f-1", type: "file", position: { x: 120, y: 120 }, data: { path: ["docs"], name: "r.pdf" } },
      { id: "future:w-1", type: "unknown-node-type", position: { x: 130, y: 130 }, data: { __originalType: "future", nested: { deep: [1, 2] } } },
    ],
    edges: [
      { id: "edge:1", source: `chat:${CONVERSATION_ID}`, target: "document:doc-1", data: { sourcePath: "data", targetKey: "input" } },
    ],
    viewport: { x: 5, y: 6, zoom: 1.25 },
    sharedState: { "shared.count": 3, "home.panels": [{ id: "x" }] },
    nodeRegistryVersion: "hash-abc",
  };
}

const priorMode = process.env.CANVAS_ROW_MODEL;
beforeEach(() => {
  delete process.env.CANVAS_ROW_MODEL;
});
afterEach(() => {
  if (priorMode === undefined) delete process.env.CANVAS_ROW_MODEL;
  else process.env.CANVAS_ROW_MODEL = priorMode;
});

// ---------------------------------------------------------------------------
// flag
// ---------------------------------------------------------------------------

describe("canvasRowMode", () => {
  it("defaults to off and parses the three modes; unknown => off", () => {
    delete process.env.CANVAS_ROW_MODEL;
    expect(canvasRowMode()).toBe("off");
    process.env.CANVAS_ROW_MODEL = "dual_write";
    expect(canvasRowMode()).toBe("dual_write");
    process.env.CANVAS_ROW_MODEL = "read_rows";
    expect(canvasRowMode()).toBe("read_rows");
    process.env.CANVAS_ROW_MODEL = "garbage";
    expect(canvasRowMode()).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// off = blob only
// ---------------------------------------------------------------------------

describe("writeCanvasLayout — off", () => {
  it("writes ONLY the blob (no workspace/canvas/node/edge rows)", async () => {
    const fake = createFakeDb();
    await writeCanvasLayout(fake.db, CONVERSATION_ID, OWNER_ID, snapshot13());
    expect(fake.blobUpserts).toHaveLength(1);
    expect(fake.canvasInserts).toHaveLength(0);
    expect(fake.workspaceInserts).toHaveLength(0);
    expect(fake.nodeUpserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (a) dual_write blob byte-identical + also writes rows
// ---------------------------------------------------------------------------

describe("writeCanvasLayout — dual_write", () => {
  it("(a) leaves the blob upsert byte-identical to the off path", async () => {
    const snap = snapshot13();

    delete process.env.CANVAS_ROW_MODEL;
    const off = createFakeDb();
    await writeCanvasLayout(off.db, CONVERSATION_ID, OWNER_ID, snap);

    process.env.CANVAS_ROW_MODEL = "dual_write";
    const dual = createFakeDb({ canvases: [], workspaces: [] });
    await writeCanvasLayout(dual.db, CONVERSATION_ID, OWNER_ID, snap);

    // insert `values` carry no timestamp — must be identical.
    expect(dual.blobUpserts[0]!.values).toEqual(off.blobUpserts[0]!.values);
    // `set` differs only by updatedAt (a fresh Date each call) — strip and compare.
    const stripTs = (s?: Row) => {
      const { updatedAt: _drop, ...rest } = s ?? {};
      return rest;
    };
    expect(stripTs(dual.blobUpserts[0]!.set)).toEqual(stripTs(off.blobUpserts[0]!.set));
  });

  it("auto-creates the personal workspace + canvas and upserts every row", async () => {
    process.env.CANVAS_ROW_MODEL = "dual_write";
    const fake = createFakeDb({ canvases: [], workspaces: [], canvasNodes: [], canvasEdges: [] });
    await writeCanvasLayout(fake.db, CONVERSATION_ID, OWNER_ID, snapshot13());

    expect(fake.blobUpserts).toHaveLength(1);
    expect(fake.workspaceInserts).toHaveLength(1);
    expect(fake.memberInserts).toHaveLength(1); // owner membership seeded
    expect(fake.canvasInserts).toHaveLength(1);
    expect(fake.canvasInserts[0]!.values).toMatchObject({
      workspaceId: WORKSPACE_ID,
      ownerUserId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      kind: "conversation",
    });
    expect(fake.nodeUpserts).toHaveLength(14);
    expect(fake.edgeUpserts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (b) RowStore round-trip + (c) shadow-compare parity
// ---------------------------------------------------------------------------

describe("RowStore round-trip + shadow-compare", () => {
  it("(b)+(c) preserves 13 types + heal + source/directory; rows reconstruct == blob", async () => {
    const input = snapshot13();

    process.env.CANVAS_ROW_MODEL = "dual_write";
    const writeFake = createFakeDb({ canvases: [], workspaces: [], canvasNodes: [], canvasEdges: [] });
    await writeCanvasLayout(writeFake.db, CONVERSATION_ID, OWNER_ID, input);

    // The blob stored the snapshot verbatim (shadow-compare's reference).
    const blob = writeFake.blobUpserts[0]!.values as unknown as CanvasSnapshot;

    // Reconstruct from the captured row upserts via readConversationRow.
    const nodeRows = writeFake.nodeUpserts.map((r) => rowFromInsert(r.values));
    const edgeRows = writeFake.edgeUpserts.map((r) => edgeRowFromInsert(r.values));
    const stamp = writeFake.canvasStamps[0]!.set;
    const readFake = createFakeDb({
      canvases: [
        {
          id: CANVAS_ID,
          viewport: stamp.viewport,
          sharedState: stamp.sharedState,
          nodeRegistryVersion: stamp.nodeRegistryVersion,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      canvasNodes: nodeRows,
      canvasEdges: edgeRows,
    });

    const row = await readConversationRow(readFake.db, CONVERSATION_ID);
    expect(row).not.toBeNull();
    const reconstructed: CanvasSnapshot = {
      nodes: row!.nodes as CanvasSnapshot["nodes"],
      edges: row!.edges as CanvasSnapshot["edges"],
      viewport: row!.viewport as CanvasSnapshot["viewport"],
      sharedState: row!.sharedState as CanvasSnapshot["sharedState"],
      nodeRegistryVersion: row!.nodeRegistryVersion,
    };

    // (b) round-trip: rows preserve every type incl. heal + content.
    expect(sortById(reconstructed.nodes)).toEqual(sortById(input.nodes));
    expect(sortById(reconstructed.edges)).toEqual(sortById(input.edges));
    expect(reconstructed.viewport).toEqual(input.viewport);
    expect(reconstructed.sharedState).toEqual(input.sharedState);
    expect(reconstructed.nodeRegistryVersion).toBe(input.nodeRegistryVersion);

    // heal + content spot-checks.
    const healed = reconstructed.nodes.find((n) => n.id === "future:w-1")!;
    expect(healed.type).toBe("unknown-node-type");
    expect(healed.data).toMatchObject({ __originalType: "future" });
    const source = reconstructed.nodes.find((n) => n.id === "source:led-1")!;
    expect(source.data).toMatchObject({ url: "https://ex.com/x", title: "S" });

    // (c) shadow-compare: reconstructed == blob (logical equality).
    expect(sortById(reconstructed.nodes)).toEqual(sortById(blob.nodes));
    expect(sortById(reconstructed.edges)).toEqual(sortById(blob.edges));
    expect(reconstructed.sharedState).toEqual(blob.sharedState);
    expect(reconstructed.nodeRegistryVersion).toBe(blob.nodeRegistryVersion);
  });
});

// ---------------------------------------------------------------------------
// (d) caps + write-time gates on the row path
// ---------------------------------------------------------------------------

describe("row-path write-time gates", () => {
  it("(d) rejects a node carrying a `spec` key (D-05) via the injected parse", async () => {
    const bad = {
      nodes: [{ id: "n", type: "genui-panel", position: { x: 0, y: 0 }, data: { spec: { type: "card" } } }],
      edges: [],
      sharedState: {},
      nodeRegistryVersion: "v",
    } as unknown as CanvasSnapshot;
    const fake = createFakeDb({ canvases: [], workspaces: [] });
    await expect(
      writeConversationRow(fake.db, CONVERSATION_ID, OWNER_ID, bad),
    ).rejects.toBeTruthy();
    // nothing upserted into the node table (parse threw before the transaction body).
    expect(fake.nodeUpserts).toHaveLength(0);
  });

  it("(d) rejects an over-cap snapshot on the row path", async () => {
    const over = {
      nodes: Array.from({ length: 201 }, (_, i) => ({
        id: `n-${i}`,
        type: "chat",
        position: { x: i, y: i },
        data: {},
      })),
      edges: [],
      sharedState: {},
      nodeRegistryVersion: "v",
    } as unknown as CanvasSnapshot;
    const fake = createFakeDb({ canvases: [], workspaces: [] });
    await expect(
      writeConversationRow(fake.db, CONVERSATION_ID, OWNER_ID, over),
    ).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// read_rows read path + fallback
// ---------------------------------------------------------------------------

describe("readCanvasLayout — read_rows", () => {
  it("reads the assembled row when a canvas exists", async () => {
    process.env.CANVAS_ROW_MODEL = "read_rows";
    const fake = createFakeDb({
      canvases: [
        {
          id: CANVAS_ID,
          viewport: { x: 1, y: 2, zoom: 1 },
          sharedState: { "shared.k": 1 },
          nodeRegistryVersion: "v9",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      canvasNodes: [
        { nodeKey: "chat:c", type: "chat", position: { x: 0, y: 0 }, width: null, height: null, data: { conversationId: "c" } },
      ],
      canvasEdges: [],
    });
    const row = await readCanvasLayout(fake.db, CONVERSATION_ID);
    expect(row).not.toBeNull();
    expect((row!.nodes as unknown[]).length).toBe(1);
    expect(row!.nodeRegistryVersion).toBe("v9");
  });

  it("falls back to the blob when no canvas row exists yet", async () => {
    process.env.CANVAS_ROW_MODEL = "read_rows";
    const blobRow = {
      id: "blob-1",
      conversationId: CONVERSATION_ID,
      nodes: [],
      edges: [],
      viewport: null,
      sharedState: {},
      nodeRegistryVersion: "vblob",
    };
    const fake = createFakeDb({ canvases: [], chatCanvasLayouts: [blobRow] });
    const row = await readCanvasLayout(fake.db, CONVERSATION_ID);
    expect(row).toEqual(blobRow);
  });

  it("prefers the RICHER blob when the canvas row is a strict subset (agent-minted partial canvas)", async () => {
    // The data-loss window the adversarial review caught: under dual_write an agent
    // addNode mints a 1-node canvas over an N-node blob; at read_rows the partial row
    // must NOT shadow the richer blob (which is still dual-written / authoritative).
    process.env.CANVAS_ROW_MODEL = "read_rows";
    const blobRow = {
      id: "blob-1",
      conversationId: CONVERSATION_ID,
      nodes: [{ id: "chat:c" }, { id: "n1" }, { id: "n2" }], // richer: 3 nodes
      edges: [],
      viewport: null,
      sharedState: {},
      nodeRegistryVersion: "vblob",
    };
    const fake = createFakeDb({
      canvases: [
        { id: CANVAS_ID, viewport: null, sharedState: {}, nodeRegistryVersion: "v9", createdAt: NOW, updatedAt: NOW },
      ],
      canvasNodes: [
        { nodeKey: "chat:c", type: "chat", position: { x: 0, y: 0 }, width: null, height: null, data: { conversationId: "c" } },
      ], // partial: 1 node
      canvasEdges: [],
      chatCanvasLayouts: [blobRow],
    });
    const row = await readCanvasLayout(fake.db, CONVERSATION_ID);
    expect(row).toEqual(blobRow); // the blob wins — no silent 1-node data loss
  });

  it("uses the row once it is at parity with the blob (backfilled) — LWW race closed", async () => {
    process.env.CANVAS_ROW_MODEL = "read_rows";
    const blobRow = {
      id: "blob-1",
      conversationId: CONVERSATION_ID,
      nodes: [{ id: "chat:c" }], // 1 node
      edges: [],
      viewport: null,
      sharedState: {},
      nodeRegistryVersion: "vblob",
    };
    const fake = createFakeDb({
      canvases: [
        { id: CANVAS_ID, viewport: null, sharedState: {}, nodeRegistryVersion: "v9", createdAt: NOW, updatedAt: NOW },
      ],
      canvasNodes: [
        { nodeKey: "chat:c", type: "chat", position: { x: 0, y: 0 }, width: null, height: null, data: { conversationId: "c" } },
      ], // 1 node — at parity with the blob
      canvasEdges: [],
      chatCanvasLayouts: [blobRow],
    });
    const row = await readCanvasLayout(fake.db, CONVERSATION_ID);
    expect(row).not.toBeNull();
    expect(row!.nodeRegistryVersion).toBe("v9"); // the ROW won (from canvas rows, not the blob)
  });
});

// ---------------------------------------------------------------------------
// best-effort safety + home board
// ---------------------------------------------------------------------------

describe("best-effort + home", () => {
  it("a dual_write row-write failure is swallowed — the blob write still lands", async () => {
    process.env.CANVAS_ROW_MODEL = "dual_write";
    // returningEmpty => the workspace insert returns no id => ensurePersonalWorkspace throws.
    const fake = createFakeDb({ canvases: [], workspaces: [] }, { returningEmpty: true });
    await expect(
      writeCanvasLayout(fake.db, CONVERSATION_ID, OWNER_ID, snapshot13()),
    ).resolves.toBeUndefined();
    expect(fake.blobUpserts).toHaveLength(1);
  });

  it("home board: off writes only the blob; dual_write also creates the home canvas", async () => {
    delete process.env.CANVAS_ROW_MODEL;
    const off = createFakeDb();
    await writeHomeCanvasLayout(off.db, OWNER_ID, snapshot13());
    expect(off.blobUpserts).toHaveLength(1);
    expect(off.canvasInserts).toHaveLength(0);

    process.env.CANVAS_ROW_MODEL = "dual_write";
    const dual = createFakeDb({ canvases: [], workspaces: [], canvasNodes: [], canvasEdges: [] });
    await writeHomeCanvasLayout(dual.db, OWNER_ID, snapshot13());
    expect(dual.blobUpserts).toHaveLength(1);
    expect(dual.canvasInserts[0]!.values).toMatchObject({ ownerUserId: OWNER_ID, kind: "home", conversationId: null });

    process.env.CANVAS_ROW_MODEL = "read_rows";
    const readFake = createFakeDb({
      canvases: [{ id: CANVAS_ID, viewport: null, sharedState: {}, nodeRegistryVersion: "vh", createdAt: NOW, updatedAt: NOW }],
      canvasNodes: [],
      canvasEdges: [],
    });
    const row = await readHomeCanvasLayout(readFake.db, OWNER_ID);
    expect(row).not.toBeNull();
    expect(row!.scope).toBe("home");
  });
});
