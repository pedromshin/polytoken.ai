# Track 3 Scout 03 — the `chat_canvas_layouts` JSONB blob + every reader/writer

Scope: an exhaustive, cited inventory of the `chat_canvas_layouts` row (Track 3b's
promotion target) and every piece of code that reads or writes it. A downstream
designer building the Workspace→Canvas→Node promotion should be able to work
**only** from this doc.

TL;DR of the shape today: **one JSONB row holds an entire board.** `nodes`
(jsonb array), `edges` (jsonb array), `viewport` (jsonb), `sharedState` (jsonb
bag) all live in a single row keyed EITHER on `conversation_id` (the /chat
canvas) OR on `(user_id, scope='home')` (the pinned home board). There is no
per-node row, no per-edge row — a node is an array element inside the blob. Every
"node type" (13 of them) is a discriminated shape inside that array. The
`scope='home'` column (migration 0046) is a bolted-on second identity on the same
table and is the clearest signal the blob is being asked to be more than one
thing.

---

## 1. The schema — `packages/db/src/schema/chat-canvas-layouts.ts`

### 1.1 Columns (the full table)

Table definition, `packages/db/src/schema/chat-canvas-layouts.ts:62-137`. The
load-bearing columns:

```ts
export const ChatCanvasLayouts = pgTable(
  "chat_canvas_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),                        // :65

    // NULLABLE since 0046 (HM-01): a home-scoped row has no conversation.
    conversationId: uuid("conversation_id").references(                 // :71-74
      () => ChatConversations.id,
      { onDelete: "cascade" },
    ),

    // HM-01 scope discriminator + home-row ownership anchor (0046).
    userId: uuid("user_id").references(() => AuthUsers.id, {            // :79-81
      onDelete: "cascade",
    }),
    scope: text("scope"),                                              // :82

    // D-05: node positions/sizes/type/data-refs — NEVER spec content.
    nodes: jsonb("nodes").notNull().default([]),                       // :85

    // D-09: data-carrying edges { id, source, target, data:{sourcePath,targetKey} }.
    edges: jsonb("edges").notNull().default([]),                       // :88

    // { x, y, zoom } — nullable until the first pan/zoom is persisted.
    viewport: jsonb("viewport"),                                       // :91

    // D-08/D-10: shared per-conversation store contents (panels.*/shared.*).
    sharedState: jsonb("shared_state").notNull().default({}),          // :95

    // D-04: NODE_TYPE_REGISTRY content-hash active at save time.
    nodeRegistryVersion: text("node_registry_version").notNull(),      // :98

    createdAt: timestamp(...).notNull().defaultNow(),                  // :100-102
    updatedAt: timestamp(...).notNull().defaultNow(),                  // :103-105
  },
```

Key point for the promotion: **`nodes` and `edges` are opaque `jsonb`.** Drizzle
types them as `unknown` at the wire; there is NO relational structure. A node is
an object inside `nodes`; there is no `node_id` column, no foreign key from a node
to the object it references (a `threadId`, `documentId`, `spreadsheetId`, etc.
lives only inside `node.data`).

### 1.2 Indexes + the CHECK constraint (`:107-136`)

Three table-level constraints:

- **`idx_chat_canvas_layouts_conversation_id`** — UNIQUE on `conversation_id`
  (`:111-113`). One row per conversation; the upsert target for `saveCanvasLayout`.
  Postgres treats NULLs as distinct, so the many home rows carrying NULL
  `conversation_id` never collide here.
- **`idx_chat_canvas_layouts_home_user`** — PARTIAL UNIQUE on `user_id`
  `WHERE scope = 'home'` (`:117-121`). One home board per user; the upsert target
  for `saveHomeCanvasLayout`.
- **`chat_canvas_layouts_scope_discriminator`** — CHECK (`:132-135`), quoted verbatim:

```ts
sql`((${t.conversationId} IS NOT NULL)::int + (${t.userId} IS NOT NULL)::int = 1)
    AND ((${t.scope} IS NULL) = (${t.conversationId} IS NOT NULL))
    AND (${t.scope} IS NULL OR ${t.scope} = 'home')`
```

This enforces the row is EITHER a conversation row (`conversation_id` NOT NULL,
`scope` NULL, `user_id` NULL) OR a home row (`conversation_id` NULL, `scope`='home',
`user_id` NOT NULL) — never a hybrid. The comment at `:126-131` records that a
prior OR-of-ANDs formulation let a junk row slip through on three-valued logic (a
skeptic finding); the total-boolean form above is the fix.

### 1.3 Migration lineage

- **`0024_chat_canvas_layouts.sql`** — the baseline table (`:12-25`). `conversation_id`
  was `NOT NULL` here (`:14`). RLS: RESTRICTIVE deny-all for both `anon` and
  `authenticated` (`:26-33`) — conversation rows are reached only by the
  superuser-role backend.
- **`0046_home_canvas_scope.sql`** — the scope bolt-on. It does five things
  (`:22-34`): drops `conversation_id`'s NOT NULL (`:22`), adds `user_id`
  (`:23`) + `scope` (`:24`) + the FK to `auth.users` (`:25`), creates the partial
  home-user unique index (`:26`), adds the discriminator CHECK (`:27`), and
  **replaces** the 0024 authenticated deny-all with a PERMISSIVE owner policy
  keyed on `user_id = auth.uid()` (`:30-34`) so home rows become owner-reachable
  while conversation rows (user_id NULL) stay denied.
- Journal order (`packages/db/migrations/meta/_journal.json`): 0044 spreadsheets,
  0045 file_versions, **0046 home_canvas_scope**, 0047 workspaces_teams_rbac.
  **0046 requires no backfill** — existing conversation rows already satisfy the
  discriminator's first branch (`0046_...sql:6-8`).

Reminder (CLAUDE.md landmine): migrations here are FILES ONLY. Nobody in this
workflow applies them; the promotion's own migration must likewise ship as a file.

### 1.4 Ownership / tenancy

`chat_canvas_layouts` has **no direct owner resolver.** It is reached only
through its parent conversation's ownership assert
(`packages/db/src/ownership.ts:13` lists it among the "reached via parent
conversation" tables). The home row is the exception: it carries a DIRECT
`user_id` and the home procedures key strictly on `ctx.user.id` (no client id to
check). This asymmetry matters for the promotion — see §11.

---

## 2. The tRPC readers/writers — every procedure

All canvas persistence procedures live in `packages/api-client/src/router/chat/`.
There are **seven** procedures across three files, plus the injectable store the
agent path uses.

### 2.1 `canvas.ts` — the conversation canvas (2 procedures)

`packages/api-client/src/router/chat/canvas.ts`, `chatCanvasProcedures` (`:54-112`):

- **`getCanvasLayout`** (query, `:59-73`) — asserts conversation ownership
  (`assertOwnedOrNotFound` → `assertConversationOwnership`, `:62-64`), then selects
  the single row `WHERE conversation_id = input.conversationId` (`:66-70`).
  Returns `row ?? null`.
- **`saveCanvasLayout`** (mutation, `:79-111`) — ownership assert first (`:84-86`),
  then **upsert via `onConflictDoUpdate` on `conversationId`** (`:88-108`). Writes
  `nodes`, `edges`, `viewport`, `sharedState`, `nodeRegistryVersion` — the WHOLE
  row, last-write-wins (`:76-77` doc: "one row per conversation, debounced
  last-write-wins snapshot from the client"). No CRDT, no per-node diff.

### 2.2 `home-canvas.ts` — the pinned home board (2 procedures)

`packages/api-client/src/router/chat/home-canvas.ts`, `chatHomeCanvasProcedures`
(`:49-115`):

- **`getHomeCanvasLayout`** (query, `:55-68`) — no client id; keys on
  `(user_id = ctx.user.id, scope = 'home')` (`:59-64`). Returns `row ?? null`.
- **`saveHomeCanvasLayout`** (mutation, `:78-114`) — input is a **bare snapshot,
  NO conversationId** (`saveHomeCanvasLayoutInputSchema`, `:42-44`). Upserts with
  `conversationId: null, userId: ctx.user.id, scope: 'home'` STAMPED from the
  session (`:86-88`), conflict target `ChatCanvasLayouts.userId` +
  `targetWhere: sql`${scope} = 'home'`` (`:96-102`). The `targetWhere` uses an
  INLINE literal, not `eq(...)`: the comment (`:97-101`) records that a
  parameterized partial-index predicate can't be matched to the partial unique
  index under prepared statements, breaking the upsert after ~5 executions per
  connection (a skeptic finding).

The home board REUSES the exact `CanvasSnapshotSchema` and node/edge/sharedState
shape (`:6-13`). It is the SAME table, same validation, same everything — only the
key differs.

### 2.3 `canvas-mutations.ts` — the agent write path (3 procedures + store)

`packages/api-client/src/router/chat/canvas-mutations.ts` — the control-plane
binding of the `canvas.addNode`/`canvas.connect`/`canvas.removeNode` capability
triple (declared in `@polytoken/capabilities`, §5). Procedures
`chatCanvasMutationProcedures` (`:349-391`):

- **`addCanvasNode`** (`:351-362`)
- **`connectCanvasNodes`** (`:365-376`)
- **`removeCanvasNode`** (`:379-390`)

Each asserts conversation ownership first (NOT_FOUND on a non-owned id), then runs
the capability by id (`registry.get("canvas.addNode")` etc., `:334-343`) against a
Drizzle-backed `CanvasMutationStore` (`createCanvasMutationStore`, `:235-328`).

This store persists through the **SAME upsert `saveCanvasLayout` uses** — one row
per conversation, `onConflictDoUpdate` on `conversationId` (`persistSnapshot`,
`:151-177`). Critical discipline (module header `:19-37`):

- **ADDITIVE, NEVER CLOBBERING** — existing nodes/edges/viewport/sharedState/
  nodeRegistryVersion carried through byte-identical; only the requested delta is
  applied (`loadSnapshot` `:106-147`, then push/filter).
- An existing row that **fails `CanvasSnapshotSchema` is REFUSED**
  (`PRECONDITION_FAILED`), never overwritten (`:132-139`).
- Caps enforced before writing (`MAX_CANVAS_NODES`/`MAX_CANVAS_EDGES`, `:247-252`,
  `:289-294`).
- **Node ids are canonical** — `canonicalNodeId(nodeType, data)` (`:187-213`)
  produces a `type:ref` id (`chat:${conversationId}`, `genui-panel:${messageId}:${partIndex}`,
  `email-thread:${threadId}`, `document:${documentId}`, `source:${sourceLedgerId}`,
  `spreadsheet:${spreadsheetId}`, `knowledge-preview:${focusNodeId}`; a random
  suffix for ref-less panel types). This makes agent adds IDEMPOTENT per referenced
  object and mirrors the client's own id helpers (§3).
- **KNOWN RACE, recorded not hidden** (`:31-37`): the UI's debounced
  `saveCanvasLayout` is a whole-row LWW upsert. If the canvas is mounted while an
  agent mutates the row, the client's next debounced save can overwrite the agent's
  delta. The mounted-and-idle window is the residual gap; closing it needs a
  client invalidation signal. **This race is a direct consequence of the
  single-blob design** — a per-node-row model would not have it.
- `AGENT_CANVAS_REGISTRY_VERSION = "agent-canvas-mutation:v1"` (`:83`) is the
  honest sentinel stamped when the server CREATES a row (it can't import the
  client's live registry hash); the client's first debounced save replaces it.

### 2.4 The snapshot contract — `canvas-schema.ts`

`packages/api-client/src/router/chat/canvas-schema.ts` — `CanvasSnapshotSchema`
(`:156-164`), the ONE data contract every reader/writer validates against. It is
split out of `canvas.ts` (`:1-14`) so a CLIENT component can import it without
pulling in the server-only Postgres client. Structure:

- `nodes: array(canvasNodeSchema).max(MAX_CANVAS_NODES)` — node =
  `{ id, type, position:{x,y}, width?, height?, data }` (`:102-111`). `data` is
  `z.record(string, unknown)` `.refine`d to reject `spec`/`root` keys (D-05,
  `:90-100`) and prototype-pollution keys at any depth.
- `edges: array(canvasEdgeSchema).max(MAX_CANVAS_EDGES)` — edge =
  `{ id, source, target, data:{ sourcePath, targetKey } }` (`:128-135`); every
  dotted-path segment guarded against `__proto__/constructor/prototype` (`:115-126`).
- `viewport: { x, y, zoom }` optional (`:137-139`).
- `sharedState: record(string, unknown)` — recursively FORBIDDEN_KEYS-guarded +
  **serialized-size capped at 100 000 chars** (`MAX_SHARED_STATE_SERIALIZED_CHARS`,
  `:77`, `:143-154`).
- `nodeRegistryVersion: string.min(1)` (`:162`).
- **Caps** (`:75-77`): `MAX_CANVAS_NODES = 200`, `MAX_CANVAS_EDGES = 400`. These
  are per-ROW limits — i.e. per board. A promotion that splits nodes into their
  own rows changes what these caps mean.

The whole object is `.strict()` (`:164`).

### 2.5 Web consumers of the procedures (who calls the hooks)

From `apps/web` (grep `api.chat.(get|save)(Canvas|HomeCanvas)Layout` + `addCanvasNode`):

| Consumer | Procedure(s) | File:line |
|---|---|---|
| `useCanvasPersistence` | `getCanvasLayout` (query), `saveCanvasLayout` (mutation) | `use-canvas-persistence.ts:471-472` |
| `ChatCanvas` (the real board) | via `useCanvasPersistence` | `chat-canvas.tsx:416` |
| `TranscriptPanelHost` (docked transcript overlay) | via `useCanvasPersistence` | `transcript-panel-host.tsx:228` |
| `HomeBoard` | `getHomeCanvasLayout` (query), `saveHomeCanvasLayout` (mutation) | `home-board.tsx:56,62` |
| `useSendTo` ("Send to canvas") | `addCanvasNode` (mutation) | `use-send-to.ts:258` |

Note `TranscriptPanelHost` and `ChatCanvas` **share the same conversation's row**
and both go through `saveCanvasLayout`'s whole-row upsert — `toFlowNode` was
deliberately hoisted into `use-canvas-persistence.ts` (`:234-281`) precisely
because any drift between the two surfaces' conversions is "a silent layout
rewrite the next time the quieter surface saves" (`:243-247`).

---

## 3. Web-side node shape + client id helpers

### 3.1 The node array element (client)

Client node shape mirrors the server `canvasNodeSchema`. `buildSnapshot`
(`use-canvas-persistence.ts:326-357`) is the ONE function that serializes React
Flow state back into a `CanvasSnapshotSchema`-valid object:

- Each node → `{ id, type: originalTypeFor(node), position:{x,y}, data: originalDataFor(node) }`
  (`:333-338`). Width/height are NOT persisted by the client path (they exist in
  the schema as optional but `buildSnapshot` omits them).
- Each edge → `{ id, source, target, data:{ sourcePath, targetKey } }` with
  string-coerced defaults (`:339-350`).
- `viewport` included only if present (`:351`).
- `sharedState` = the canvas store's `values` bag, default `{}` (`:330`, `:353`).
- `nodeRegistryVersion` = `NODE_REGISTRY_VERSION` (`:353`).

**Degrade/heal discipline:** a node whose type this session's registry doesn't
recognize is rendered as `unknown-node-type` but its ORIGINAL type/data is
reconstructed on save (`originalTypeFor` `:291-299`, `originalDataFor` `:304-309`)
so a future registry addition can heal it — the placeholder identity is never
baked in. **The promotion MUST preserve this** (a node it doesn't recognize must
survive round-trips).

### 3.2 Canonical node id helpers (client)

`use-canvas-persistence.ts` exports the id scheme (`:85-104`):

- `chatNodeId(conversationId)` → `chat:${conversationId}` (`:85-87`)
- `genuiPanelNodeId(messageId, partIndex)` → `genui-panel:${messageId}:${partIndex}` (`:89-91`)
- `sourceNodeId(sourceLedgerId)` → `source:${sourceLedgerId}` (`:102-104`) — flagged
  as "THE WIRING SEAM" for auto-materializing ledger rows (`:94-101`); see §5 note.

These are the mirror of the server's `canonicalNodeId` (§2.3). Node ids are
STRINGS embedding the referenced object id — there is no separate FK.

### 3.3 The restore/reconcile pipeline

`reconcileNodesFromHistory(savedNodes, historyRows)` (`:153-207`) — pure:

- **Pass 1** (`:166-174`): every saved node restored at its EXACT saved position
  (D-06); an unrecognized type degrades to `unknown-node-type` keeping its position
  (never throws, never blanks the canvas).
- **Pass 2** (`:180-204`): any `genui_spec`/`interactive_widget` message part in
  `historyRows` with no matching saved node (a turn that completed since the last
  save) gets a fresh dagre-seeded position nudged clear of placed nodes.

`withDefaultChatNode` (`:216-232`) synthesizes the always-present chat node
(`chat:${conversationId}`) if the reconcile result lacks it. `validateSavedRow`
(`:416-436`) re-validates the persisted row against `CanvasSnapshotSchema` on the
READ side too — a tampered/legacy row degrades to an EMPTY canvas rather than being
trusted (T-23-09).

`chat-canvas.tsx` layers reconcile + default-chat-node synthesis on top of
`initialNodes` in a single seed-then-reconcile effect (`:483-524`).

### 3.4 The node-type registry (13 types + placeholder)

`apps/web/src/app/chat/_canvas/node-type-registry.ts` — `NODE_TYPE_REGISTRY`
(`:43-122`) is the allowlist. `resolveNodeType` NEVER throws (`:134-140`). The 13
registered types, each with a Zod `dataSchema`:

| type | data schema (module) | node.data carries | rehydrates via |
|---|---|---|---|
| `chat` | `ChatNodeDataSchema` (node-data-schemas.ts:60-64) | `conversationId` | embedded MessageList |
| `genui-panel` | `GenuiPanelNodeDataSchema` (:39-52) | `provenance{messageId,partIndex,runId}`, `turnIndex` — **NEVER spec** | `chat_messages` by provenance |
| `knowledge-preview` | `KnowledgePreviewNodeDataSchema` (:73-78) | `focusNodeId`, `label?` | knowledge graph |
| `email-thread` | `EmailThreadNodeDataSchema` (:90-96) | `threadId`, `label?` | `emails.threadCard` |
| `document` | `DocumentNodeDataSchema` (:108-114) | `documentId`, `label?` | `documents.byId` |
| `source` | `SourceNodeDataSchema` (:239-252) | `sourceLedgerId`, `url`, `title`, `excerpt?`, `tier?` — **DELIBERATE deviation: display payload IS in node.data** | nothing (renders synchronously) |
| `directory` | `DirectoryNodeDataSchema` (panel-node-schemas.ts:87-96) | `path`, `label?`, bounded `entries?` preview | daemon `fs.list` |
| `browser` | `BrowserNodeDataSchema` (:104-116) | `url?`, `label?` | daemon `browser.screenshot` |
| `editor` | `EditorNodeDataSchema` (:123-131) | `filePath`, `label?`, `language?` | daemon `fs.read`/`fs.write` |
| `desktop` | `DesktopNodeDataSchema` (:153-169) | `sessionId?`, `status?`, `label?`, `region?`, `shape?` | desktop control plane |
| `circle-pack` | `CirclePackNodeDataSchema` (:278-301) | `scope(mailbox\|entity\|drive)`, `entityId?`, `importerId?`, `folderPath?`, `label?` | `emails.circlePackLandscape` / `files.folderSizeRollup` |
| `spreadsheet` | `SpreadsheetNodeDataSchema` (:126-132) | `spreadsheetId`, `label?` | `spreadsheets.byId` |
| `file` | `FileNodeDataSchema` (:176-192) | `path[]`, `name`, `label?` (tenant-relative vault ref) | `files` router |

Plus `unknown-node-type` → `UnknownNodeTypePlaceholder` (`node-types.ts:52`), the
inert degrade target.

The React Flow component map is `node-types.ts` `nodeTypes` (`:33-53`),
`resolveNodeComponent` never throws (`:61-67`).

**The ref-only discipline (D-05) with two deliberate exceptions:** almost every
node.data carries ONLY a ref and rehydrates content via tRPC. The exceptions,
stated so nobody "fixes" them into broken fetches:

1. **`source`** (node-data-schemas.ts:196-254) — carries the immutable display
   payload (`url`/`title`/`excerpt`) itself because a `chat_source_ledger` row is
   INSERT-only and has no per-row read procedure; N sources must not cost N queries.
2. **`directory`** (panel-node-schemas.ts:14-20) — carries a bounded `entries`
   preview snapshot for the same reason (no per-row read for a daemon folder).

These are the two node types whose CONTENT lives in the blob and would need
explicit migration handling if nodes move to their own rows.

**Threat note reused across many schemas:** node.data arrives from
`chat_canvas_layouts`, a user-writable row, and restore re-validates only the
GENERIC `CanvasSnapshotSchema` — NOT the per-type schemas. So per-type schemas
gate hostile values at write time (http(s)-only urls, safe vault segments) and the
render components re-guard (defense in depth). A promotion that changes the write
path must keep these write-time gates.

### 3.5 Edges (how they're stored)

Edge = `{ id, source, target, data:{ sourcePath, targetKey } }`
(`canvas-schema.ts:128-135`, `edge-payload-schema.ts`). `source`/`target` are node
ids (the string ids above). `data.sourcePath`/`targetKey` are dotted paths into
the canvas store, resolved by `resolveCanvasPath` (canvas-store.ts:65-77) through
the SAME grammar a panel uses to read its own state. Agent-created edges default
`sourcePath`/`targetKey` from `CANVAS_CONNECT_DEFAULT_SOURCE_PATH`/`_TARGET_KEY`
(canvas-mutations.ts:266-267). Edges are a flat array in the blob, capped at 400.

### 3.6 sharedState (the cross-panel store)

`apps/web/src/app/chat/_canvas/canvas-store.ts` — a per-conversation vanilla
Zustand store. `values` is ONE flat bag under two namespaces:
`panels.{panelId}.{key}` and `shared.{key}` (`:112-124`). Only a bounded 5-mutation
enum (`toggle/set/reset/increment/decrement`, `:28-34`) — never arbitrary
reducers. It **hydrates from the persisted `sharedState`** on mount
(`createCanvasStore` seed, `:142-180`; consumed via `initialSharedState`,
use-canvas-persistence.ts:494) and is written back verbatim at save time
(`buildSnapshot` reads `canvasStore.getState().values`, use-canvas-persistence.ts:533).
Streaming/derived values are never written into the store, so nothing transient is
persisted (`:319-324`). `sharedState` is the ONE place cross-panel wiring survives
reload (D-10) and is a THIRD kind of state stuffed into the same row alongside
nodes and edges.

---

## 4. `scope='home'` — what it does and why it is a strain symptom

**What it does:** it lets `chat_canvas_layouts` store a SECOND kind of board — the
pinned home board at `/home` — without a new table. A home row is
`(conversation_id NULL, user_id NOT NULL, scope='home')`; a conversation row is
`(conversation_id NOT NULL, user_id NULL, scope NULL)`. The discriminator CHECK
keeps them mutually exclusive, a partial unique index gives one home board per
user, and the home procedures (§2.2) key on `(user_id, scope='home')`. The design
comment sells it explicitly: "ONE discriminator, not a new table"
(chat-canvas-layouts.ts:22-27; 0046_...sql:4-5).

**Why it is a symptom of the blob straining** — concrete evidence in the code:

1. **A nullable FK + a CHECK constraint now stand in for what a type column
   should express.** `conversation_id` had to be made nullable
   (`0046_...sql:22`), and a three-way boolean CHECK
   (chat-canvas-layouts.ts:132-135) is required to stop hybrid junk rows. The
   comment even records that the FIRST version of that CHECK let a malformed row
   through on three-valued logic (`:126-131`). That is complexity the table
   absorbed because it is being asked to be two things.

2. **Ownership is now asymmetric on one table.** A conversation row has NO direct
   owner (reached via the parent conversation, ownership.ts:13); a home row has a
   DIRECT `user_id` and its own RLS policy (0046_...sql:28-34). Two tenancy models
   coexist in one table.

3. **The home board doesn't actually use nodes/edges at all.** `HomeBoard`
   persists an EMPTY `nodes: []`, `edges: []` and stuffs the pinned panel
   arrangement into `sharedState` under a `home.panels` key (home-board.tsx:80-96,
   `HOME_PANELS_KEY = "home.panels"` :28). It even stamps its own
   `nodeRegistryVersion = "home-v1"` (:29). So a home row reuses the blob's SHAPE
   but means something entirely different by it — `sharedState` is now overloaded
   to also hold a home layout. The comment concedes the cost-meter panel HM-01
   wanted was omitted because "inventing a user-level cost aggregate is out of
   scope" (:50-53) — the home board is straining against the conversation-shaped
   row it borrowed.

4. **Every reader/writer must now filter by scope to avoid cross-contamination.**
   The home procedures add `eq(scope, 'home')` to every read/write
   (home-canvas.ts:59-64, :102) specifically so "a home procedure can never return
   or clobber a conversation row" (:20-23). That guard exists only because the two
   record types share a table.

The takeaway for the promotion: `scope='home'` is the seam where "a canvas is
tied to exactly one conversation" already broke once. A Workspace→Canvas→Node
model should make Canvas a first-class row with its own identity and owner, of
which the conversation canvas and the home board are two instances — rather than a
third `scope` value bolted onto the same blob.

---

## 5. Every writer of canvas nodes (the writer inventory)

A node reaches a `chat_canvas_layouts.nodes` array through exactly one of these
paths. The promotion must preserve ALL of them.

### 5.1 Client writers (chat-canvas.tsx → `saveCanvasLayout` whole-row upsert)

All of these call `setNodes(...)` then `persistence.scheduleSave(canvasStore)`
(debounced ~800ms whole-row save, use-canvas-persistence.ts:441, :520-565). Each
places near viewport center with `offsetCascadePosition` collision avoidance and
records an undo step:

| Feature | Handler | node type / id scheme | node.data | file:line |
|---|---|---|---|---|
| **Default chat node** | seed effect / `withDefaultChatNode` | `chat` / `chat:${conversationId}` | `{ conversationId }` | chat-canvas.tsx:499-506; use-canvas-persistence.ts:216-232 |
| **GenUI panel** (materialized from history) | reconcile Pass 2 | `genui-panel` / `genui-panel:${messageId}:${partIndex}` | `{ provenance, turnIndex }` | use-canvas-persistence.ts:129-207 |
| **Knowledge preview** | `handleAddKnowledgePreview` | `knowledge-preview` / `knowledge-preview:${uuid}` | `{ focusNodeId, label? }` | chat-canvas.tsx:679-710 |
| **Email thread** | `handleAddEmailThread` | `email-thread` / `email-thread:${uuid}` | `{ threadId }` | chat-canvas.tsx:716-747 |
| **Circle-pack (Email treemap / Drive treemap)** | `handleAddCirclePack('mailbox'\|'drive')` | `circle-pack` / `circle-pack:${uuid}` | `{ scope }` | chat-canvas.tsx:754-785 |
| **Spreadsheet (tabular)** | `handleAddSpreadsheet` (blank sheet created in AddNodeMenu first) | `spreadsheet` / `spreadsheet:${uuid}` | `{ spreadsheetId }` | chat-canvas.tsx:792-823; add-node-menu.tsx:86-93 |
| **Document** | `handleAddDocument` (blank doc created in AddNodeMenu first) | `document` / `document:${uuid}` | `{ documentId }` | chat-canvas.tsx:830-861; add-node-menu.tsx:95-103 |
| **Duplicate selection** | `runDuplicate` | copies selected nodes with new ids | copied node.data | chat-canvas.tsx:887-896 |
| **Paste** | (clipboard) `runCopy`/`paste` | pasted nodes (chat node excluded from copy) | copied node.data | chat-canvas.tsx:911-935 |

The **AddNodeMenu** (add-node-menu.tsx:105-160) is the touch-reachable entry point
enumerating what the canvas "can materialize today": Email treemap, Drive treemap,
Spreadsheet, Document, Email thread…, Knowledge node… (`:118-157`). The blank
spreadsheet/document creates happen IN the menu (`spreadsheets.create` /
`documents.create`, `:83-103`) before the id is handed to the canvas host.

### 5.2 The agent writer (`addCanvasNode` → additive server upsert)

`useSendTo.sendToCanvas` (use-send-to.ts:306-313) and the mid-turn tool loop both
reach `chat.addCanvasNode` (§2.3), which writes through the additive server store.
`useSendTo` supports 4 sendable kinds today (`objectToCanvasNode`, :118-162):
`knowledge_node` → `knowledge-preview`, `document` → `document`, `vault_file` →
`file`, `email_thread` → `email-thread`. The agent capability allowlist
(`CANVAS_NODE_DATA_SCHEMAS`, capabilities/canvas.ts:126-237) permits ALL 13 types.
The agent's optimistic patch (use-send-to.ts:258-295) mutates the cached
`getCanvasLayout` row's `nodes` array directly.

### 5.3 The home writer (`saveHomeCanvasLayout`)

`HomeBoard.onPinBoard` (home-board.tsx:80-96) writes a home row with **empty
nodes/edges** and the panel arrangement in `sharedState["home.panels"]`. It is a
node writer only nominally — it writes the blob but keeps nodes empty.

### 5.4 The docked-transcript writer

`TranscriptPanelHost` (transcript-panel-host.tsx:228) uses the same
`useCanvasPersistence` and feeds the restored layout straight back as live state so
a transcript-scheduled save round-trips the conversation's row (T-61-21,
use-canvas-persistence.ts:239-247). It shares the conversation row with `ChatCanvas`.

### 5.5 Note on the `source` node "auto-materialize" seam

`source` nodes have a canonical id (`sourceNodeId`, §3.2) and a full render
component (`source-node.tsx`), and the agent path can add them
(`canonicalNodeId` case "source", canvas-mutations.ts:206-207; `source` in the
capability allowlist). But the client-side reconcile that would AUTO-materialize
`chat_source_ledger` rows onto the canvas is described as a **wiring seam anchored
at `sourceNodeId`** (use-canvas-persistence.ts:94-101) — there is no
`listSources`-driven auto-placement in `chat-canvas.tsx` today (grep confirms no
ledger-read materialization there). Tier flips on an existing source node persist
through the normal debounced save (`handlePromotionSettled`, chat-canvas.tsx:671-673).
The promotion should treat `source` as a live writer (agent + future auto-seam).

---

## 6. What a Workspace→Canvas→Node promotion must preserve / migrate

The promotion's goal (Track 3b) is to turn the single JSONB blob into first-class
Workspace / Canvas / Node rows. This inventory says it must carry ALL of the
following across, or it will silently break a shipped feature:

**Data that must survive round-trips (per row today):**
1. **Two board identities** — conversation-scoped (`conversation_id`) AND
   home-scoped (`user_id, scope='home'`). Both are `chat_canvas_layouts` rows now;
   the new Canvas row must model both (a Canvas belongs to a conversation OR is a
   user's home board). Don't collapse them into one implicit assumption.
2. **13 node types + the `unknown-node-type` degrade path.** Every type's
   `node.data` shape (§3.4) and its ref-only vs. content-carrying nature. The two
   CONTENT-carrying types — `source` (url/title/excerpt) and `directory`
   (entries preview) — must migrate their inline payload, not just a ref.
3. **The heal-on-restore contract** — an unrecognized node type must survive a
   round-trip with its original type/data intact (originalTypeFor/originalDataFor,
   use-canvas-persistence.ts:291-309).
4. **Edges** — `{id, source(node id), target(node id), data:{sourcePath, targetKey}}`.
   `source`/`target` are the string node ids; if nodes get real row ids, edges
   need remapping.
5. **`viewport`** — `{x, y, zoom}`, per board.
6. **`sharedState`** — the `panels.*`/`shared.*` Zustand bag (§3.6), 100 000-char
   cap, dotted-path grammar shared with edges. **Overloaded on home rows** to hold
   `home.panels`. A node-relational model still needs a per-canvas place for this.
7. **`nodeRegistryVersion`** — per board (D-04), including the agent sentinel
   `agent-canvas-mutation:v1` and the home `home-v1`.

**Behavioral invariants that must not regress:**
8. **Additive-never-clobber** on the agent path (canvas-mutations.ts:19-37) — and
   ideally, moving to per-node rows should CLOSE the known whole-row LWW race
   (canvas-mutations.ts:31-37) rather than reproduce it.
9. **Ownership asymmetry** — conversation canvas reached via parent conversation
   ownership; home canvas via direct `user_id`. A Workspace model introduces a
   THIRD path (shared access). Note `shared_resource_type` enum
   (enums.ts:108-113) is `document/entity/file/conversation` — **there is NO
   `canvas` value**; sharing a canvas via `resource_shares` (resource-shares.ts)
   would require extending that enum AND adding a canvas owner resolver in
   `access-control.ts` (enums.ts:106 states the extension recipe explicitly).
10. **Write-time security gates** per node type (http(s)-only urls, safe vault
    segments, prototype-pollution guards, D-05 no-spec refine) — the restore path
    trusts only the generic schema, so per-type write gates are load-bearing.
11. **The canonical id scheme** — client (`chatNodeId`/`genuiPanelNodeId`/
    `sourceNodeId`, use-canvas-persistence.ts:85-104) and server
    (`canonicalNodeId`, canvas-mutations.ts:187-213) must agree, or agent-placed
    and client-placed nodes double up. Any new Node primary key must keep these
    idempotency semantics (a node is identified by `type:referencedObjectId`).
12. **Caps** — `MAX_CANVAS_NODES=200`, `MAX_CANVAS_EDGES=400`,
    `sharedState` 100 000 chars (canvas-schema.ts:75-77). Per-row today = per-board;
    define what they mean post-split.

**All write paths that must keep working (§5):** the 9 client materializers +
duplicate/paste, the 3 agent mutation procedures, `useSendTo`'s 4 sendable kinds,
the home pin, and the docked-transcript save — every one currently funnels through
either `saveCanvasLayout` (whole-row upsert) or `addCanvasNode` (additive upsert).
Both funnels are keyed on `conversation_id` (or `user_id` for home); the promotion
changes what they write into, so all of them are touch points.

---

## Appendix — file map

| Concern | Path |
|---|---|
| Schema | `packages/db/src/schema/chat-canvas-layouts.ts` |
| Migrations | `packages/db/migrations/0024_chat_canvas_layouts.sql`, `0046_home_canvas_scope.sql` |
| Conversation procedures | `packages/api-client/src/router/chat/canvas.ts` |
| Home procedures | `packages/api-client/src/router/chat/home-canvas.ts` |
| Agent mutation procedures + store | `packages/api-client/src/router/chat/canvas-mutations.ts` |
| Snapshot contract | `packages/api-client/src/router/chat/canvas-schema.ts` |
| Agent capabilities (declaration) | `packages/capabilities/src/canvas.ts` |
| Restore/save hook | `apps/web/src/app/chat/_canvas/use-canvas-persistence.ts` |
| The board | `apps/web/src/app/chat/_canvas/chat-canvas.tsx` |
| Node data schemas | `apps/web/src/app/chat/_canvas/node-data-schemas.ts`, `panel-node-schemas.ts` |
| Node type registry / RF map | `apps/web/src/app/chat/_canvas/node-type-registry.ts`, `node-types.ts` |
| sharedState store | `apps/web/src/app/chat/_canvas/canvas-store.ts` |
| Add-node UI | `apps/web/src/app/chat/_canvas/add-node-menu.tsx` |
| Send-to affordance | `apps/web/src/app/_components/use-send-to.ts` |
| Home board | `apps/web/src/app/home/_components/home-board.tsx` |
| Docked transcript | `apps/web/src/app/chat/_canvas/transcript-panel-host.tsx` |
| Workspace/share model (promotion target) | `packages/db/src/schema/workspaces.ts`, `resource-shares.ts`, `enums.ts:84-113` |
