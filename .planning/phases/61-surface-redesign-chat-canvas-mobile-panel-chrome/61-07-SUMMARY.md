---
phase: 61-surface-redesign-chat-canvas-mobile-panel-chrome
plan: 07
subsystem: chat-transcript-canvas-overlay-seam
tags: [chat, canvas, panel-overlay, transcript, SURF-07, 999.17, T-61-21, data-loss, react-reconciliation, criterion-4]
requires:
  - "52-01's panel-overlay.ts (resolveActivePanel / parseOverlay / setPack / appendVersion) — pure, reused verbatim"
  - "23-04's use-canvas-persistence.ts (genuiPanelNodeId / reconcileNodesFromHistory / buildSnapshot / scheduleSave)"
  - "23-05's canvas-store-context.tsx (useCanvasStoreInstance's ready gate, toCanvasStoreSeed)"
  - "61-01's screenshot theme axis + chat-thread surface; 61-05's chat-canvas surface (D-61-05-A)"
  - "61-03's page.tsx docked/canvas branch; 61-04's message-turn.tsx part switch"
provides:
  - "TranscriptPanelHost — the provider seam giving the docked/mobile transcript the overlay store without React Flow"
  - "the T-61-21 round-trip mechanism: the restored layout IS the live state, so a transcript save cannot empty the row"
  - "useIsTranscriptPanelHost() — the marker 61-08's toolbar mounts on (NOT store presence, NOT a viewport check)"
  - "useOptionalPanelOverlay / useOptionalCanvasStore — non-throwing reads for the three-tree problem"
  - "toFlowNode with ONE definition, moved to use-canvas-persistence.ts beside ReconciledNode"
  - "transcript-overlay.test.tsx — criterion 4's gate + the layout-destruction regression test (15 assertions)"
  - "a genui panel in the committed captures for the FIRST time (chat-thread + chat-canvas, both themes)"
affects:
  - "61-08 (mounts its toolbar on useIsTranscriptPanelHost(); inherits the seam AND the pre-ready-throw hazard)"
  - "61-08 (the fixture now seeds the genui part its toolbar renders into — D-61-07-C: seed the canvas node too)"
  - "Phase 62/63 (D-61-07-A: genui packs are light-only — a product decision, not a restyle)"
  - "any future capture surface (D-61-07-B: persisted UI state bleeds across captures in file order)"
tech-stack:
  added: []
  patterns:
    - "a host that flips element type on ready REMOUNTS its whole subtree — readiness must travel in VALUES, never in SHAPE"
    - "a null context value is indistinguishable from an absent provider to a consumer that already null-checks — use it to keep one tree"
    - "a marker context, not store presence, is what tells two transcripts apart when both legitimately have providers"
    - "a data-loss regression test must be red-proven against the naive version — 13/15 stayed green while the layout was deleted"
    - "jsdom does no layout; the rendered-geometry gate caught a React reconciliation bug 15 unit assertions could not"
key-files:
  created:
    - apps/web/src/app/chat/_canvas/transcript-panel-host.tsx
    - apps/web/src/app/chat/_components/__tests__/transcript-overlay.test.tsx
  modified:
    - apps/web/src/app/chat/_canvas/panel-overlay-context.tsx
    - apps/web/src/app/chat/_canvas/canvas-store-context.tsx
    - apps/web/src/app/chat/_canvas/use-canvas-persistence.ts
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
    - apps/web/src/app/chat/_components/message-turn.tsx
    - apps/web/src/app/chat/_components/message-list.tsx
    - apps/web/src/app/chat/page.tsx
    - apps/web/src/app/chat/__tests__/chat-mobile-feed.test.tsx
    - apps/web/e2e/helpers/screenshot-fixtures.ts
    - apps/web/e2e/screenshot-review.spec.ts
decisions:
  - "D-61-07-1: toFlowNode MOVED to use-canvas-persistence.ts, not exported from chat-canvas.tsx. chat-canvas is reached only via dynamic(ssr:false), so importing from it would drag xyflow's runtime AND its UNLAYERED stylesheet onto the /chat route — the stylesheet that beats every layered utility before specificity (61-06's finding)."
  - "D-61-07-2: readiness travels in VALUES, never in SHAPE. The host renders ONE tree always; a ready-flip from Fragment to Provider remounted the entire transcript (found by test:geometry, invisible to 15 green unit assertions)."
  - "D-61-07-3: the toolbar seam is a MARKER (useIsTranscriptPanelHost), not store presence — the canvas's own ChatNode transcript has both providers, so store-presence gating would grow a second toolbar inside a node on the board."
  - "D-61-07-4: messageId is a REQUIRED prop. Optional would let a caller silently stop resolving overlays — criterion 4 regressing with every test green. The 13 test call sites it forced are the compile error doing its job."
  - "D-61-07-5: genui_spec_streaming routes through the SAME resolver with isStreaming told truthfully (T-61-24), rather than being skipped as 'cannot have an overlay'. The streaming-forces-base guarantee only holds if the flag reaches the resolver."
  - "D-61-07-6: the transcript's pack-less panels now render in the DEFAULT pack (light) exactly as the canvas's always have. Not wrapping them would make the two surfaces disagree for the COMMON case — i.e. re-create 999.17. The light-in-dark consequence is logged as D-61-07-A, not silently deviated from."
  - "D-61-07-7: the edge round-trip is a SPREAD, not chat-canvas's toFlowEdge. buildSnapshot reads 4 fields; toFlowEdge's others are presentation and would drag MarkerType (a runtime xyflow import) onto /chat. A spread also carries fields it has never heard of — for a function whose job is 'change nothing', enumerating is the fragile choice."
metrics:
  duration: ~200 min
  completed: 2026-07-16
  tasks: 3
  commits: 6
  tests_added: 15
---

# Phase 61 Plan 07: TranscriptPanelHost — Criterion 4 & the Layout-Destruction Hazard — Summary

Closed ROADMAP criterion 4 and backlog 999.17's read half: a panel re-themed or regenerated on the
canvas now renders that way in the docked/mobile transcript of the same conversation. The seam is
`TranscriptPanelHost`, and it is wired so a transcript-scheduled save **round-trips** the canvas
layout instead of deleting it.

**Three real bugs were found by refusing to trust green tests**: the data-loss hazard the plan
named (red-proven), a **full-transcript remount** on every layout query (found by the geometry gate,
invisible to 15 green unit assertions), and a **pre-ready crash** that would have taken out 61-08's
toolbar on first paint (found by writing the T-61-21 test).

## What Shipped

| Task | Commit | What |
|------|--------|------|
| 1 | `0e0f290` | `TranscriptPanelHost` + the T-61-21 round-trip; `toFlowNode` moved; the non-throwing reads |
| 2 | `e7dcd13` | the transcript resolves overlays — criterion 4 |
| 3 | `4c245c9` | `transcript-overlay.test.tsx` — 15 assertions incl. the T-61-21 regression |
| — | `6309962` | **fix: the host was remounting the whole transcript on every ready-flip** |
| — | `4ad3b3a` | **fix: the harness could not see a genui panel, and its dark transcript was the canvas** |
| — | `324f12b` | restore LF on two test files a script rewrote as CRLF (1,628 lines of phantom diff) |

## THE T-61-21 RED PROOF — verbatim, and what the naive version deleted

The naive wiring the plan exists to prevent, applied to the committed host:

```tsx
const persistence = useCanvasPersistence({
  conversationId,
  nodes: PRE_RESTORE_NODES,   // []
  edges: PRE_RESTORE_EDGES,   // []
  viewport: null,
});
```

```
❯ src/app/chat/_components/__tests__/transcript-overlay.test.tsx (15 tests | 2 failed)
  × T-61-21 — a transcript-scheduled save must never destroy the canvas layout >
    round-trips the persisted layout: the save payload still carries every seeded node, edge and the viewport
    → expected [] to deeply equal [ { …(4) }, { …(4) }, { …(4) } ]

AssertionError: expected [] to deeply equal [ { …(4) }, { …(4) }, { …(4) } ]
- Expected
+ Received
- Array [
-   Object {
-     "data": Object { "conversationId": "00000000-0000-0000-0000-0000000000a1" },
-     "id": "chat:00000000-0000-0000-0000-0000000000a1",
-     "position": Object { "x": 10, "y": 20 },
-     "type": "chat",
-   },
-   Object {
-     "data": Object {
-       "provenance": Object {
-         "messageId": "11111111-1111-1111-1111-111111111111",
-         "partIndex": 0,
-         "runId": null,
-       },
-       "turnIndex": 1,
-     },
-     "id": "genui-panel:11111111-1111-1111-1111-111111111111:0",
-     "position": Object { "x": 420, "y": 260 },
-     "type": "genui-panel",
-   },
-   Object {
-     "data": Object { "threadId": "22222222-2222-2222-2222-222222222222" },
-     "id": "email-thread:22222222-2222-2222-2222-222222222222",
-     "position": Object { "x": 900, "y": 40 },
-     "type": "email-thread",
-   },
- ]
+ Array []
 ❯ src/app/chat/_components/__tests__/transcript-overlay.test.tsx:575:36
```

**What it deleted:** all three nodes — the conversation's own chat node, the genui panel the user was
re-theming, and the email-thread card they had placed at (900, 40) — plus the data edge wiring the
chat node into the panel, plus the viewport they had panned to. `Received: Array []`. One re-theme,
from a phone, and the board is empty. The second T-61-21 case (an overlay written over an existing
overlay) failed identically.

**The number that matters: 13 of the 15 assertions stayed GREEN**, including every criterion-4
assertion — the re-theme crossing, the regenerated version crossing, all three trees. The feature
worked perfectly while destroying the user's board. That is precisely why this test had to exist and
had to be red-proven; a regression test for a data-loss bug that has never been seen to fail is not
evidence.

### The mechanism, VERBATIM (61-08 inherits it)

`scheduleSave` snapshots `latestStateRef.{nodes,edges,viewport}` at fire time; `saveCanvasLayout`
**upserts the whole row** (`CanvasSnapshotSchema` requires `nodes`+`edges`; no partial-save path).
So the host feeds the **restored layout back in as the live state**:

```tsx
const live = restored?.conversationId === conversationId ? restored : null;

const persistence = useCanvasPersistence({
  conversationId,
  nodes: live?.nodes ?? PRE_RESTORE_NODES,
  edges: live?.edges ?? PRE_RESTORE_EDGES,
  viewport: live?.viewport ?? null,
});

useEffect(() => {                       // seed-once, idempotent by identity guard
  if (isRestoring) return;
  setRestored((current) =>
    current?.conversationId === conversationId ? current : {
      conversationId,
      nodes: initialNodes.map(toFlowNode),          // the SAME toFlowNode the canvas uses
      edges: initialEdges.map(toRoundTripFlowEdge), // a spread — carries unknown fields through
      viewport: initialViewport ?? null,
    });
}, [conversationId, isRestoring, initialNodes, initialEdges, initialViewport]);
```

A transcript save therefore writes back exactly what it read, plus the new `sharedState`.

**The window is closed structurally, not with an `isRestoring` check** (that is the same bug wearing
a race): the persistence context is `null` until the restore *is* the live state the hook was handed
on this render. `null` is indistinguishable from an absent provider — `useCanvasPersistenceContext`
already null-checks and throws — so `usePanelOverlay` refuses to write before there is a real
snapshot to write alongside.

### `TranscriptPanelHost`'s exact props

```tsx
export interface TranscriptPanelHostProps {
  readonly conversationId: string;
  readonly children: React.ReactNode;
}
export function TranscriptPanelHost(props: TranscriptPanelHostProps): React.ReactElement;
export function useIsTranscriptPanelHost(): boolean;  // 61-08's mount marker
```

No `onOpenConversation` (that is `EmailThreadNode`'s, a canvas node). No `CanvasEdgesProvider`
(edges are drawn on the board; `useIncomingEdgesForPanel` already degrades). No `CanvasSpecProvider`
(the transcript *has* its spec — it is reading the message part). No React Flow.

## The second bug: the host was REMOUNTING the entire transcript

**Found by `npm run test:geometry`. Invisible to all 15 unit assertions — jsdom does no layout.**

The gate reported the transcript's ScrollArea viewport at **0px client height**. The obvious read is
a broken height chain, so I measured it instead of assuming:

```
[61-07 DIAG] /chat @ 1440x900 message transcript
  DIV.h-full w-full rounded-[inherit]                h=783 client=783
  DIV.relative overflow-hidden h-full                h=783 client=783
  DIV.relative min-h-0 flex-1                        h=783 client=783
  DIV.flex h-full min-h-0 flex-col bg-bright         h=856 client=856
  ...
```

**The chain was perfectly healthy at 783px.** Two `evaluate` calls on the same locator disagreed —
because the DOM changed between them. The host returned `<>{children}</>` before the layout query
resolved and `<CanvasStoreProvider>…</CanvasStoreProvider>` after. **React reconciles by element
type**, so that flip unmounted and remounted the *entire transcript* the instant a background query
settled: the composer's draft, the scroll position, and every effect's state, discarded
mid-conversation, for a query whose whole purpose is to be invisible. The gate was measuring a node
React had just detached.

Bisected to certainty rather than argued: replacing the wrapper with a bare `React.Fragment` →
**3 passed**; restoring it → **1 failed**.

**Fix**: one tree, always. Readiness travels in the values — a per-host placeholder store, a `null`
persistence context, a `false` marker — never in the shape. Semantics identical (no overlay
resolves, no write is possible, no toolbar mounts pre-restore); only the remount is gone.
`CanvasPersistenceProvider`'s `value` widened to `| null`, which is what its context was always
typed as; every existing caller passes a real value and is unaffected.

**This is the generalisable one**: any conditional provider wrapper written as
`ready ? <Providers>{children}</Providers> : <>{children}</>` has this bug. It is a *correctness*
bug that presents as a *layout* symptom, and only a rendered gate can see it.

## The third bug: 61-08's toolbar would have crashed on first paint

Writing the T-61-21 test, the first run threw:

```
Error: usePanelOverlay must be used inside a CanvasPersistenceProvider (canvas host wiring — see chat-canvas.tsx)
 ❯ Module.usePanelOverlay src/app/chat/_canvas/panel-overlay-context.tsx:148:17
 ❯ OverlayWriter src/app/chat/_components/__tests__/transcript-overlay.test.tsx:247:28
```

Not a test bug — **the host's own contract biting**. The transcript must never block on a layout
query, so children render before the providers exist; `usePanelOverlay` throws without persistence,
by design. `layoutQuery.isPending` starts true on **every mount**, so a control calling
`usePanelOverlay` unconditionally inside this host dies on every first render.

**61-08 mounts exactly such a control.** This is what the planner's host-marker decision structurally
prevents, and it is why the marker lives in this file rather than in the plan that needs it:

```tsx
export function useIsTranscriptPanelHost(): boolean;   // true ONLY inside the ready branch
```

A marker, **not store presence** — the canvas's own ChatNode transcript has a store *and* a
persistence context, so gating on those would mount a second panel toolbar inside a node on the
board, beside the real one. And **not a viewport check** — the docked transcript exists on the
desktop too, and gets editing for free. Gated three ways in the suite (true in a ready host; false
inside the canvas's providers; false bare).

## What I SAW

`npm run screenshot:review`, 2 runs, 41 PNGs each, both themes, ISO-filtered latest run (D-61-01).
Final: `.planning/ui-reviews/2026-07-16T06-24-06-201Z/`, `select:ok` (thread) / `select:ok tab:ok`
(canvas).

**First I had to make the surface visible at all.** The `chat-thread` fixture seeded a tool row and
prose — **no genui part**. The panel is the entire subject of 999.17's read half and of this plan,
and no committed capture had ever contained one: D-61-04-A's blindness, exactly. Seeded a real
`genui_spec` part (a card + key-value-list quote summary). `chat.getHistory` replays `parts`
verbatim (D-18), so it renders through the identical path a live panel would, at zero model cost.
**61-08 mounts its toolbar into this very part.**

**Then the dark transcript turned out to be the canvas.** `chat-thread-desktop-dark.png` showed the
header toggle on **Canvas**. `chat-thread` and `chat-canvas` are the same conversation;
`chat-canvas` clicks "Canvas view", which persists to
`localStorage["polytoken.chat.canvas-view:{id}"]` by design; one browser context is reused across
surfaces and both theme passes, so the dark pass's `chat-thread` faithfully restored "canvas" and
photographed **the board under the transcript's filename, with `select:ok` beside it**. True since
`chat-canvas` joined the surface list. No gate could see it — the picture was of a real, correctly
rendered surface, just not the one on the label. Fixed with an `addInitScript` that drops the key
before every capture. (The key prefix was **read from the source, not guessed** — my first guess,
`chat:canvas-view`, was wrong and would have cleared nothing while appearing to work by accident of
capture order.)

**With both fixed, what the captures show:**

1. **Criterion 4, visibly, on one screen.** In `chat-canvas-desktop-dark.png` the ChatNode's
   transcript panel (centre) and the genui-panel *node* (bottom-right, "From turn 0" / "Polytoken
   Teal") render the **same content in the same pack**. They agree. Before this plan the ChatNode's
   transcript rendered on app tokens while the panel node rendered in its pack — two panels of one
   panel's content disagreeing *on the same screen*.
2. **The docked transcript renders the panel in both themes** — `chat-thread-desktop-{light,dark}`.
   The quote card, its key-value rows, the turn's action row, all bounded in the reading column.
3. **The panel is a WHITE card in dark mode** — and this is the finding worth reading. It is **not
   new and not mine**: `PanelThemeScope` injects `getStylePack(...).resolvedVars`, and `packs.ts`
   has **no dark variants**, so the canvas's panel nodes have been light-on-dark since Phase 23. My
   change makes the transcript *match* that. Not wrapping pack-less specs would have made the
   transcript disagree with the canvas for the common case — re-creating 999.17. Logged as
   **D-61-07-A** with the product question (is a pack a light-mode artifact the app frames, or a
   theme that must follow the app?), which is a Rule-4 decision for `packages/genui`, not a restyle.

**What I did NOT see, said plainly: the mobile transcript with a conversation selected.** Every
mobile chat capture is `select:n/a-overlay-rail` — the rail is an overlay Sheet, so there is no row
to click without opening it. Criterion 4's "**mobile** transcript" half has no photograph.
`screenshot-review.spec.ts`'s own header records that **two** prior attempts at driving the rail
toggle were actively harmful ("so the third person does not try a fourth"), and I did not try a
third. What covers mobile instead, honestly: `effectiveViewMode = isMobile ? "chat" : viewMode`
means mobile renders the *same* docked branch, same host, same `MessageTurn` — there is no
mobile-specific transcript code — and `chat-mobile-feed.test.tsx` proves the host genuinely mounts
there, because its tRPC mock **had to learn `getCanvasLayout`/`saveCanvasLayout`** in this plan. That
is mechanism evidence, not a picture. Logged as **D-61-07-D**.

## Per-File Changes

**`transcript-panel-host.tsx`** (new, 336 lines) — the seam. Restores via `useCanvasPersistence`,
feeds the restore back as the live state (T-61-21), builds one store per conversation via
`useCanvasStoreInstance(id, toCanvasStoreSeed(initialSharedState), live !== null)` — a *stricter*
ready gate than chat-canvas's `!isRestoring`, so the store and the persistence context appear in the
same commit, both already backed by a real snapshot. Renders children unwrapped-in-effect (one
stable tree) until then. `useMemo` on the context value (§F). Exports the marker.

**`use-canvas-persistence.ts`** — `toFlowNode` + `DRAG_HANDLE_SELECTOR` + `GENUI_PANEL_CLASS_NAME`
moved here beside `ReconciledNode`, exported. **One definition**: two surfaces share one upserted
row, so a second conversion is a silent layout rewrite waiting to happen. Moved rather than exported
from `chat-canvas.tsx` for a load-bearing bundling reason (D-61-07-1).

**`chat-canvas.tsx`** — imports the three moved symbols; `ReconciledNode`'s now-unused type import
dropped. Nothing else: the provider stack, skeleton guard, save triggers and seed-once effect are
exactly as 61-05/61-06 left them.

**`panel-overlay-context.tsx`** — `useOptionalPanelOverlay` (non-throwing read, raw-reference memo
preserved, module-level empty fallback store documented as read-only-by-construction);
`CanvasPersistenceProviderProps.value` widened to `| null`. `usePanelOverlay` still throws.

**`canvas-store-context.tsx`** — `useOptionalCanvasStore()`, mirroring `useIncomingEdgesForPanel`'s
degrade posture already in that file.

**`message-turn.tsx`** — `TranscriptGenuiPanel` (a child component, because a hook cannot be called
inside `parts.map`); both genui branches route through it with the real `isStreaming`; `messageId`
required. Every other part branch, `isFailed`/`isCostCapBlocked`, the status badge and the action row
untouched.

**`message-list.tsx`** — `messageId={turn.id}` as an explicit prop (a key is not a prop).

**`page.tsx`** — the host wraps the **docked branch only**, with the mutual-exclusion invariant
stated in a comment. `useWebllmEngine()` (D-08) still a single top-level instance —
verified by reading, not `grep -c`, which reported 2 (one is a doc comment).

## Deviations from Plan

**1. [Rule 2 — added] `useIsTranscriptPanelHost()`, the host marker.** Not in the plan's `exports`,
but the brief names it as the planner's mount decision and it structurally prevents a real crash
(above). Only this file can provide it correctly — it is the thing that knows when it is ready.

**2. [Rule 1 — fixed] The ready-flip remount.** Not in the plan; found by the geometry gate. Forced
widening `CanvasPersistenceProvider`'s `value` to `| null` (additive, backward-compatible).

**3. [Rule 3 — blocking] `chat-mobile-feed.test.tsx`'s tRPC mock** learned
`getCanvasLayout`/`saveCanvasLayout`. Not a chore: the docked branch now genuinely queries them, and
that suite catching it is direct evidence the host mounts on mobile — criterion 4's mobile half.

**4. [Rule 3 — blocking] 13 `MessageTurn` test call sites** gained `messageId` across two files
outside `files_modified`. That is the required prop doing its job (D-61-07-4).

**5. [Scope — taken] Two harness fixes** (`screenshot-fixtures.ts`, `screenshot-review.spec.ts`),
both outside `files_modified`. Without them the surface this plan changes is unphotographable and
the dark transcript capture is a lie. The brief sanctions extending the fixture and forbids
throwaway probes. Both serve 61-08 directly.

**6. [Rule 1 — fixed] LF restored on two test files** a script rewrote as CRLF — 1,628 lines of
phantom diff hiding a 13-line change. Zero content change (`--ignore-cr-at-eol` shows exactly 13),
32 tests still green.

**7. [Scope — NOT taken] `packs.ts` dark variants** (D-61-07-A). Architectural (Rule 4), affects
`/studio`, the catalog and every genui surface; the two surfaces now agree, which is what this plan
owed.

**8. [Scope — NOT taken] A mobile capture with a conversation selected** (D-61-07-D) — the harness's
own header explicitly warns off a third attempt.

**9. [Scope — NOT taken] `role-hue-ban`'s `SCOPED_DIRS`** — 61-08's call, per the brief.

**10. [Pre-existing] `tsconfig.json` / `next-env.d.ts` churn left unstaged** — D-61-02.

## Negative Proofs — all executed against the COMMITTED tree

**1. The empty-nodes host (the one that matters)** — RED, verbatim above. 2 failed / **13 passed**.
Reverted.

**2. `MessageTurn` ignores the resolved spec** (`packId={DEFAULT_PACK_ID}`, `specJson={specJson}`) —
RED on 4 assertions:

```
× a RETHEME made on the canvas crosses: the transcript resolves the OVERRIDE pack, not the base spec's
  → expected '--primary: hsl(164 39% 22%)' to be '--primary: hsl(262 83% 58%)'
× a REGENERATED version crosses: the transcript renders the ACTIVE version's spec, not the base
  → expected 'BASE PANEL CONTENT' to contain 'REGENERATED PANEL CONTENT'
× the three trees > (a) DOCKED, inside TranscriptPanelHost — resolves the overlay
× the three trees > (b) ON THE CANVAS, inside a real ChatNode — resolves from the CANVAS's own store
Tests  4 failed | 11 passed (15)
```
Reverted.

**3. `useOptionalPanelOverlay` throws on a missing provider** — RED on case (c) and 9 others:

```
× the three trees > (c) BARE, with no providers at all — renders the base spec and does NOT throw
  → NEGATIVE PROOF 3: missing CanvasStoreProvider
Tests  10 failed | 34 passed (44)
```
Reverted. **A sharper finding than expected**: `message-stream-law.test.tsx` (29 tests) stayed
**green** — no pre-existing suite mounts a `MessageTurn` with a genui part, so "it protects the 44
chat suites" is not quite the reason. The real load is a **production path**: "NO canvas row at all"
also went red, and that is every conversation never opened on the canvas — i.e. most of them. The
non-throwing read prevents a live crash on the common case, not just test churn.

**4. No proof edit leaked.** `git diff --stat HEAD` for `apps/web/src/app/chat/` and `apps/web/e2e/`
both empty after the reverts; `git status --short` clean for both.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **79 files / 980 passed**, 2 skipped — baseline 78/960 + this plan's 15 (+5 elsewhere), **zero regressions** |
| `npm run test:geometry` | **3 passed** — RED before the remount fix, which is how the remount was found |
| `npm run build:local` (from `apps/web`, D-61-05) | `✓ Compiled successfully in 7.6s` |
| `npm run screenshot:review` | 41 PNGs × 2 runs, both themes, `select:ok` / `select:ok tab:ok`; read at full size |
| `packages/genui/src/renderer/spec-renderer.tsx` | **byte-identical** — `git diff` over the plan's range empty |
| No server change (T-61-23) | `git diff --name-only 0e0f290~1..HEAD -- packages/` **empty** |
| 61-07's real diff | 14 files, +1358/−55 |

## Threat model compliance

**T-61-21** — mitigated, red-proven, and the mechanism is recorded verbatim above for 61-08.
**T-61-22** — `parseOverlay`'s degrade posture inherited, not "improved" into a throw; gated by "an
INVALID stored overlay degrades to the base spec and never throws". **T-61-23** — accepted, and
verified: zero files under `packages/` touched; the transcript reaches the same `protectedProcedure`s
with the same session and conversationId the canvas does. A new caller, not a new capability.
**T-61-24** — `isStreaming` is threaded, never assumed; `genui_spec_streaming` routes through the
same resolver *precisely so* the guarantee has somewhere to bite; gated by "STREAMING forces the base
spec verbatim even with an active version stored". **T-61-SC** — no packages installed.

**Threat flags:** none. No network, auth, file or schema boundary touched.

## Success criteria

- [x] **A panel re-themed or regenerated on the canvas renders that way in the docked transcript of
      the same conversation** — 999.17's read half, closed. Gated six ways (re-theme, regenerated
      version, no overlay, no canvas row, invalid overlay, streaming) and *seen*, in both themes.
- [x] **The canvas's own ChatNode transcript honors overlays too, through the canvas's store, with
      no second host** — verified with a real `ChatNode` mount, not assumed, and visible in
      `chat-canvas-desktop-dark.png` agreeing with the panel node beside it.
- [x] **A save scheduled from the transcript provably round-trips the canvas layout** — asserted by a
      test red-proven against the naive implementation, which deleted three nodes, an edge and the
      viewport while 13/15 assertions stayed green.
- [x] **The transcript never blocks on a canvas-layout query, and never throws without providers** —
      and, beyond the plan, never *remounts* on one either.

**SURF-07 stays Pending, deliberately.** It is a two-clause requirement — *"editable-panel chrome is
reachable on mobile AND the docked/mobile transcript honors panel overlays"*. This plan closes the
second clause only. **61-08 carries the first** (the editing toolbar, mounted on this host's marker),
and it should be the plan that marks SURF-07 complete. Same shape as 61-06 leaving SURF-02 Pending.
**ROADMAP criterion 4 is fully met.**

## Notes for later plans

- **61-08: mount your toolbar on `useIsTranscriptPanelHost()`.** Not on store presence (the canvas's
  ChatNode transcript has both providers — you would grow a second toolbar on the board), not on a
  viewport check (desktop docked should get editing too). **And you must gate**: children render
  before the providers exist, so an ungated `usePanelOverlay` throws on every mount's first render.
  The hook goes in the CHILD of the gate — a conditional render, never a conditional hook call. The
  shape is in `transcript-overlay.test.tsx`'s `OverlayWriter`.
- **61-08: you inherit the T-61-21 hazard.** Every save you schedule through this host round-trips
  the layout *because the host feeds the restore back as the live state*. Do not "simplify" that into
  empty arrays, and do not add an `isRestoring` guard instead — both are the bug.
- **61-08: the fixture now seeds the genui part your toolbar renders into**, visible in
  `chat-thread-*` in both themes. **D-61-07-C**: the canvas's copy of that node lands half outside
  the seeded viewport — seed it into `SEEDED_CANVAS_NODES` if you want it fully in frame.
- **Anyone writing a conditional provider wrapper: never flip element type on ready.**
  `ready ? <Providers>{children}</Providers> : <>{children}</>` remounts everything below it. Put
  readiness in the values. A null context value is indistinguishable from an absent provider to any
  consumer that already null-checks.
- **Anyone adding a capture surface: persisted UI state bleeds across captures in file order**
  (D-61-07-B), silently, and the resulting photograph is of a real surface — just not the labelled
  one. Reset per capture.
- **Phase 62/63: genui packs are light-only** (D-61-07-A). Every genui panel is a white card in dark,
  on both surfaces. Decide it once, for both.

## Self-Check: PASSED

```
FOUND: apps/web/src/app/chat/_canvas/transcript-panel-host.tsx
FOUND: apps/web/src/app/chat/_components/__tests__/transcript-overlay.test.tsx
FOUND: apps/web/src/app/chat/_canvas/panel-overlay-context.tsx
FOUND: apps/web/src/app/chat/_canvas/canvas-store-context.tsx
FOUND: apps/web/src/app/chat/_canvas/use-canvas-persistence.ts
FOUND: apps/web/src/app/chat/_canvas/chat-canvas.tsx
FOUND: apps/web/src/app/chat/_components/message-turn.tsx
FOUND: apps/web/src/app/chat/_components/message-list.tsx
FOUND: apps/web/src/app/chat/page.tsx
FOUND: apps/web/e2e/helpers/screenshot-fixtures.ts
FOUND: apps/web/e2e/screenshot-review.spec.ts
```
Commits verified in `git log`: `0e0f290`, `e7dcd13`, `4c245c9`, `6309962`, `4ad3b3a`, `324f12b`.

**No stubs.** No `TODO`/`FIXME`/placeholder introduced. No scratch dir written under
`.planning/ui-reviews/` (D-61-01).
