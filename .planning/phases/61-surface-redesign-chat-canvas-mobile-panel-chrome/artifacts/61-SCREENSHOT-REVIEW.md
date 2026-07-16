# Phase 61 — Screenshot Review: /chat and its Canvas, both themes

**Run:** `.planning/ui-reviews/2026-07-16T07-20-21-279Z/` (40 PNGs, gitignored — T-61-27)
**Reviewed:** 2026-07-16, by 61-08
**Method:** `cd apps/web && npm run screenshot:review` (never a bare `npx playwright test` — T-61-03)

> **The standard this follows is 60-07's, and it is the most valuable precedent in this project:
> split the verdict at exactly the line the evidence supports.** Every claim below is PROVEN or
> UNPROVEN. An unproven thing is named UNPROVEN, not waved through. No capture that did not run is
> described. The harness is a CAMERA, not a gate — it reports `1 passed` over a photograph of a
> crash, so nothing here rests on its exit code.

---

## 0. Liveness — proven BEFORE a single frame was reviewed

60-07 reviewed 14 plausible-looking PNGs of an app that had never executed client JS. That check
therefore runs first, and its result gates everything below.

| Check | Result | Evidence |
|---|---|---|
| `.next` not corrupted by a second compiler (999.22) | **PROVEN clean** | `.next/BUILD_ID` **absent** — that file is a *production build's* signature, and its absence is the decisive discriminator |
| The two other "tell-tales" | **NOT corruption** — see finding 6 | `prerender-manifest.json` and `.next/package.json` carry the dev server's own startup stamp (`20:22:04`); `build:local` correctly targets `.next-verify` (`BUILD_ID` @ 03:18) |
| The stylesheet the page links actually loads | **PROVEN** | `GET /_next/static/css/app/layout.css` → **HTTP 200, 157,979 bytes** |
| The sheet is compiled from current source | **PROVEN** | it contains the `@utility touch-target` rule this plan added, hot-reloaded and measured live |
| The app hydrates | **PROVEN** | every row of `index.md` reads `settled`; `chat-thread`/`chat-canvas` desktop read `select:ok` / `select:ok tab:ok` — a click landed and a real element gated the shutter, so client JS ran |
| Rendered geometry green before photographing | **PROVEN** | `npm run test:geometry` → **6 passed** |
| Frames are the surface their filename claims | **PROVEN** | the dark `chat-thread` frames show the header toggle on **Chat** — 61-07's D-61-07-B (localStorage bleed captured the CANVAS under the transcript's name, with `select:ok` beside it) does **not** recur |
| No PNG committed (T-61-27) | **PROVEN** | `.planning/ui-reviews/` is gitignored; verified with `git check-ignore` |

---

## 1. Criterion 3 — the editable-panel toolbar reaches the phone (SURF-07, 999.17's write half)

### PROVEN — the toolbar mounts in the docked transcript, in both themes

`chat-thread-desktop-light.png` / `chat-thread-desktop-dark.png`. On the genui panel, a toolbar row:
**"Polytoken Teal"** pack switcher at the left, four icon buttons at the right (edit params,
regenerate, re-theme, history). The header toggle reads **Chat**, so this is the docked transcript,
not the board.

**This is the first time these four controls have ever rendered outside a React Flow node.** Since
Phase 52 they existed only inside `GenuiPanelNode`, and `effectiveViewMode = isMobile ? "chat" :
viewMode` means the canvas never mounts below `md` — so on a phone they did not exist at all.

### PROVEN — the canvas's ChatNode grows NO second toolbar

`chat-canvas-desktop-{light,dark}.png`, **visible on one screen**: the ChatNode (top-centre) renders
the same genui panel in its transcript **with no toolbar**, while the real `GenuiPanelNode`
(bottom-right, "From turn 0") **has** one. Both trees hold the store *and* the persistence context,
so this is the picture of the bug **not** happening — it is what the marker buys, and store-presence
gating would have put a second toolbar inside that node.

Red-proven, not assumed (`transcript-panel-toolbar.test.tsx` against store-presence gating):
```
expected [ <div role="toolbar" …(2)>…(2)</div> ] to have a length of +0 but got 1
usePanelOverlay must be used inside a CanvasPersistenceProvider   ×7
```

### PROVEN — "reachable means operable" at 390px, on a real touch pointer

Not a photograph, and deliberately so: a touch target is a **rendered box**, and the claim is about a
thumb. `npm run test:geometry` drives the **real mobile transcript** (390×844, `hasTouch` +
`isMobile`, real auth, a real seeded genui panel) and measures:

| Measurement | Result |
|---|---|
| `(pointer: coarse)` actually matches | asserted first — the suite **cannot pass vacuously** |
| Style pack / Edit parameters / Regenerate / Re-theme reachable | **4/4 visible** in the mobile transcript |
| Each ≥ 44×44px (WCAG 2.5.8 / D-48-07) | **4/4 pass** |
| Pack dropdown opens, options on-screen and tappable | **pass** |
| Edit-parameters popover opens and stays on-screen (`w-80` = 320px vs 390px) | **pass** |

**And it was RED before this plan's first commit** — see finding 5. Without the `touch-target` fix,
`'Edit parameters' renders 24x24px on a touch device`. Criterion 3 would have been declared closed
with 24px thumb targets.

### UNPROVEN — there is no mobile PHOTOGRAPH of the transcript

`chat-thread-mobile-{light,dark}.png` are the **empty state** ("Ask me anything"), recorded honestly
as `select:n/a-overlay-rail`. Below `md` the rail is an overlay Sheet, so no conversation row exists
to click without opening it. **D-61-07-D stands; I did not photograph the mobile transcript.**

What covers mobile instead, stated as mechanism rather than dressed up as a picture:
- `effectiveViewMode = isMobile ? "chat" : viewMode` — mobile renders the **same** docked branch,
  the same host, the same `MessageTurn`. There is no mobile-specific transcript code.
- The geometry gate above drives that surface **at 390px on a touch pointer** and measures the
  toolbar's real boxes. For "operable", that is *stronger* evidence than a photograph.
- `chat-mobile-feed.test.tsx` proves the host genuinely mounts there (61-07).

The screenshot harness's own header warns that two prior attempts at driving the rail toggle were
actively harmful, "so the third person does not try a fourth". I did not try a fourth **in that
harness**. The geometry gate reaches the same surface on its own terms — which is precisely what that
header asks for ("that surface is SURF-07's, and it should capture it on its own terms").

---

## 2. Criterion 1 — is /chat *designed*, or recoloured?

**PROVEN — structurally different, not a re-token.** Phase 51 already re-tokened this surface and the
user's verdict was still "ugly/experimental", so "it has new colours" is this phase's failure mode,
not its success. What is visibly different in kind:

- **The roles are told apart by HIERARCHY, not by a rail.** The user's turn is a right-aligned
  `--shade` bubble; the assistant's turn is simply the page — no rail, no card, no border. v1.4's
  `border-l-2` assistant rail is gone. The answer *is* the surface rather than a thing sitting on it.
- **The genui panel is a real card with a real header row**, not a bare bordered box: a `--hair`
  rule, chrome above, content below.
- The composer is a bounded field aligned to the reading column; the rail's New-chat is outlined
  (a deliberate hierarchy correction — D-61-07 notes the resulting disagreement with the empty
  state's filled CTA, still open and not mine).
- Citation chip, tool-round row ("Searched emails — 1 result") read as a quiet registry line rather
  than a bubble.

**UNPROVEN — whether the user finds it beautiful.** No test and no reviewer can settle that; it is
exactly what the checkpoint is for. Three milestones of "looks fine" produced 999.18.

---

## 3. Criterion 2 — zero stock React Flow, and I looked at a handle

**PROVEN by looking** (`chat-canvas-desktop-{light,dark}.png`):

| Element | Verdict |
|---|---|
| Board | polytoken dot grid at zoom 1 — parchment in light, graphite in dark. Not xyflow's grey. |
| Controls (bottom-left) | a real card (+ / − / fit / lock), not xyflow's white column |
| Keyboard hint | a bottom-centre card (61-06's D-61-05-B fix), no longer a full-width `bg-background/95` strip |
| Panel cluster (top-right) | a real card |
| **Handles** | **looked at, as instructed.** The connection point at the ChatNode's left edge and the dot at the panel's right edge are ink-toned and small — **not** the stock navy dot with a white border. |
| Attribution | "React Flow" visible bottom-right — D-61-06-B (it was being *occluded* by the old hint strip; no gate could see that) |
| Node kinds | separated by left-rule WEIGHT, never hue: chat `border-l-4`, email-thread `border-l-2`, genui-panel `border-l` — all `border-l-ink` |

**UNPROVEN — the node SELECTION treatment.** D-61-06-A: the fixture seeds no selected node, so no
committed PNG shows a selected card in either theme. The ink outline's classes were proven to EMIT;
how it *looks* is still unphotographed. Not actioned — a harness decision, unchanged from 61-06.

**UNPROVEN — the minimap.** Session-only and off by default; not toggled in this run.

---

## 4. The three laws

### Law 1 — colour is earned. **PROVEN, and it now has a gate over it.**

No hue on chrome in either theme: buttons, the rail, the composer, node selection, focus — all ink.
`chat/` joined `role-hue-ban.test.ts`'s `SCOPED_DIRS` this plan, which required clearing **11 real
violations first** (10 madder-on-a-state + 1 retired role hue). `ALLOWLIST` is still empty.

**The half no gate can see, done by reading** — the fill-vs-text rule is a PROXY for intent, and
60-06 found `<Badge variant="destructive">Preview failed</Badge>` passing it while violating law 1.
Every allowed-by-the-gate madder occurrence in `chat/`:

| Occurrence | Judgement |
|---|---|
| `delete-conversation-dialog.tsx:60` — `bg-destructive` + paired foreground | **GENUINE.** An `AlertDialogAction` labelled "Delete", `aria-label="Confirm conversation delete"`, in a dialog whose own copy reads *"This permanently deletes all messages… This can't be undone."* Exactly what the irreversible colour is reserved for. **No change.** |

**1 of 1 checked by reading. No badge-shaped violation found in `chat/`.**

### Law 2 — chrome speaks sans, evidence speaks serif. **PROVEN, on one screen.**

`chat-canvas-desktop-light.png` carries the pair the brand guide should quote:

- **ChatNode title** "Screenshot review: Q3 renewal thread" → **SANS**. A conversation title is
  polytoken's own label for a conversation, not the mail's words.
- **EmailThreadNode subject** "Screenshot review fixture: Q3 renewal qu…" → **SERIF +
  `data-evidence`**. The mail's own words, in full.

Two titles, same size, same weight, on adjacent cards, and the *provenance* of the words is the only
thing that differs — which is the whole law, visible without reading a line of source. Verified in
source too: `email-thread-node.tsx` applies `font-serif` to the SPANS (never the header row) and
avoids `pmark`/`chip` precisely because those imply serif.

### Law 3 — type is shape, never hue. **PROVEN.**

Node kind reads from left-rule weight (above); tier owns solid-vs-dashed on edges; the data edge is
`--edge` neutral because a structural wire is plumbing and states no tier. `thread-cluster-indicator`
lost its retired role hue this plan — the Mail **glyph** says "email".

---

## 5. Dark mode — seen properly, and it holds

**PROVEN.** The identity promises hue and chroma hold across themes with only lightness moving, and
on this surface that survived contact: long assistant prose is comfortable on the graphite ground,
the rail's rules stay hairline rather than turning into black gaps, and nothing legible in light
disappears.

**The panel is a WHITE card in dark — and it is NOT a Phase 61 defect.** `PanelThemeScope` injects
`getStylePack(...).resolvedVars` and `packs.ts` has **no dark variants**, so the canvas's panel nodes
have been light-on-dark since Phase 23. This is **D-61-07-A**, a `packages/genui` product decision
(is a pack a light-mode artifact the app frames, or a theme that must follow the app?) — explicitly
not this plan's to restyle.

**What this plan did change, and it is an improvement visible in dark:** the panel's frame and its
toolbar are now the APP's ink, *outside* `PanelThemeScope`. Previously the transcript's panel was
wrapped by `GenuiCard` **inside** the scope, so its border was the PACK's light `--border` — a light
rectangle floating on the dark app (compare `2026-07-16T06-24-06-201Z/chat-thread-desktop-dark.png`).
Now: a `--rule` frame and a graphite toolbar around a white pack card. The chrome/content boundary is
where law 1 says it belongs. **This is why the toolbar had to mount outside the theme scope** — inside
it, the toolbar itself would have been a light strip on a dark app.

**999.25 is live and is NOT a design gap** (§G): the fixture seeds zero entities/extractions, so
pencil-amber `--sugg` has never rendered anywhere. `/chat` showing no suggested tier is the FIXTURE.
Not reported as a finding, not fixed here.

**The "N" badge over "Sign out" is the Next.js dev indicator.** Not a bug.

---

## 6. Findings — things I saw that were not in the plan

1. **`pointer-coarse:touch-target` emitted NOTHING for three milestones** (fixed, `7551130`). See §5
   of the summary. The 44px floor never applied to the four panel-toolbar icon buttons.
2. **60-07's `.next`-corruption tell-tale list is over-broad.** It names `BUILD_ID`,
   `prerender-manifest.json` and `server/pages/_document.js`. **Two of those three are normal
   `next dev` output** — `prerender-manifest.json` carries the dev server's own startup timestamp
   (identical to `.next/package.json` and `.next/static/development`, to the second), and Next
   compiles a default Pages-Router `_document` even in an App-Router app. Following the heuristic
   literally would have had me `rm -rf .next` and restart a perfectly healthy server. **`BUILD_ID` is
   the real discriminator** — it is the artifact a production build writes, and `build:local` has
   targeted `.next-verify` since `7df5ad2`. Logged to `deferred-items.md`.
3. **D-61-07-C is still open, with a measured reason.** The seeded genui-panel node lands half
   outside the canvas fixture's viewport. 61-07 handed this to 61-08 expecting it to want the node in
   frame. **I did not fix it**: the node's `min-height` is 272px and the free board area under the
   tuned viewport (`{x:380, y:360, zoom:1}`) measures ~238px tall, so seeding it in frame means
   re-tuning positions that 61-05/61-06 measured painfully — and whose own comment records that a bad
   one "reads as a node-layout bug". The panel node's toolbar is legible enough at the clip to verify
   this plan's restyle (the pack switcher and the `--hair` rule are visible in both themes), and the
   same toolbar is fully visible in the transcript. Re-tuning a working capture for a marginal frame
   was not a trade worth making; a phase that owns the canvas fixture should take it deliberately.

---

## Verdict

| Claim | Verdict |
|---|---|
| Criterion 3 — four controls reachable AND operable at 390px | **PROVEN** (measured on a touch pointer; red-proven at 24px without the fix) |
| Criterion 3 — a mobile PHOTOGRAPH of the transcript | **UNPROVEN** — none exists (D-61-07-D) |
| The canvas ChatNode grows no second toolbar | **PROVEN** — visible, and red-proven |
| Criterion 1 — /chat is designed, not recoloured | **PROVEN structurally**; *beauty is the user's call* |
| Criterion 2 — zero stock React Flow, handles included | **PROVEN by looking** |
| Node selection treatment | **UNPROVEN** — in no capture (D-61-06-A) |
| Law 1 / Law 2 / Law 3 | **PROVEN**, incl. the read the gate cannot do |
| Dark mode holds | **PROVEN**; panel-white is D-61-07-A, pre-existing and not ours |

**The one thing no artifact here can settle is whether the user likes it.** That is the checkpoint.
