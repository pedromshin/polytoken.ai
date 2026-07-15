# Phase 60 — Screenshot review (ROADMAP criterion 4)

**Date:** 2026-07-15
**Plan:** 60-07
**Harness:** `cd apps/web && npm run screenshot:review`
**RUN_DIR:** `.planning/ui-reviews/2026-07-15T23-03-03-157Z/`

## Verdict in one line

**Criterion 4 is PARTIALLY PROVEN, and the unproven half is named precisely below.** The capture
ran — four times, against a real local stack with a real seeded session — so this is *not* the
blocked-environment gap that 51-07 and 55-01 recorded. But the dev server on port 3000 is serving a
**corrupted `.next`**, and the corruption's effect is exact and provable: **client JavaScript never
executes.** Every surface captured is a *pre-hydration SSR snapshot*. The redesigned **frames** are
therefore proven; the redesigned **rows and overlays** — which only exist after hydration — are not.

Nothing in this document is a fabricated or "representative" image (§D). Every claim below is read
off a PNG in the RUN_DIR, and every claim I could not read off a PNG is marked UNPROVEN.

## Files captured (14 PNGs + index.md)

login, inbox, chat, knowledge, studio, forwarding, emails × {mobile 390, desktop 1440}.
All 14 recorded `captured` (no `/login` redirects — the seeded session worked).
The PNGs are gitignored and stay that way (§A, T-60-11). No signed URL, cookie, token or
`.env.local` value appears in this artifact.

**Missing vs. the 07-12 baseline:** `studio-*-linear-clean.png` (0 captured, 2 expected).
Explained under Studio — it is a symptom of the same root cause, not a design regression.

## The environment finding (this is the important part)

The server answering port 3000 has a corrupted `.next` build directory — the damage the briefing
described, still live. Four independent pieces of evidence, in the order I found them:

| # | Evidence | What it proves |
|---|---|---|
| 1 | `GET /_next/static/css/app/layout.css` → **404, 9 bytes** | The compiled CSS chunk was missing. The *first* capture run was completely unstyled — giant unconstrained SVG blobs, browser-default blue links, bullet markers. |
| 2 | `/emails/[id]` renders a **Next.js runtime error overlay**: `Cannot find module './383.js'`, require stack → `apps/web/.next/server/webpack-runtime.js`, `apps/web/.next/server/pages/_document.js` | A **server webpack chunk is missing**. Note `pages/_document.js` — a *Pages-Router* artifact in an App-Router app. That is stale, mixed build output: the two-compilers-on-one-`.next` signature. |
| 3 | `app-sidebar.tsx:98` renders `<Sun className="size-4 opacity-0" />` as its **pre-mount placeholder**; every capture shows *no* theme icon, while `Sign out`'s icon (static) renders fine. The 07-12 baseline shows the moon. | `mounted === false` at capture time → **React never mounted**. |
| 4 | A **fully warm, zero-touch re-run** produced captures **byte-identical** to the prior run (inbox-desktop 39833→39833, knowledge 21938→21938, forwarding 26326→26326, emails 111711→111711) | The state is **deterministic**, not a race. A cold-compile timing issue would jitter the bytes. The page reaches a stable terminal state and stays there. |

**Conclusion:** this is not "the capture was too early" (400 ms settle) and not "the stack is down".
The stack is up and healthy. Client JS is not executing, deterministically. Evidence #4 is what
rules out the innocent explanation, and it is why the gap below is stated as a fact rather than a
suspicion.

### Root cause — found, and it is a trap in our own plans

`apps/web/.next` contains **production-build artifacts sitting on top of a live dev server's
build directory**:

| Artifact | Kind | mtime |
|---|---|---|
| `.next/BUILD_ID` | production build only | **19:40:46** |
| `.next/required-server-files.json` | production build only | **19:40:46** |
| `.next/prerender-manifest.json` | production build only | **19:40:52** |
| `.next/export-marker.json` | production build only | **19:40:52** |
| `.next/server/pages/_document.js` — *the file in the runtime error's require stack* | production build | **19:40:24** |
| `.next/static/development` | dev server | (coexisting) |

**`next build` ran at ~19:40 into the same `.next` the running `next dev` was serving from.** It
overwrote the dev server's server chunks with production output; the dev server kept its old module
graph in memory and now requires `./383.js`, which no longer exists in the shape it expects. That
is the whole failure, and it explains every symptom above — including why a *Pages-Router*
`_document.js` exists in an App-Router app (`next build` emits one; `next dev` does not use it).

This predates this session (first capture: 19:51; my first probe: ~19:47).

**The mechanism is not the two-dev-servers hypothesis.** It is
**`npm run build:local` executed while a dev server is running** — and that command is mandated by
the `<verification>` section of *this plan and every other plan in Phases 59-63*:

> `cd apps/web && npm run build:local` succeeds.

`next build` and `next dev` share `apps/web/.next` by default. So the standing verification
instruction **silently destroys the running dev server every time it is followed**, and the damage
only becomes visible the next time somebody tries to look at the app — which is exactly this plan.
60-06 ran `build:local` and reported it green; it was green, and it also corrupted the server.

**Recommendation (backlog):** either run `build:local` with a separate build dir
(`distDir`/`NEXT_DIST_DIR`) so it cannot collide, or make the verification line state that the dev
server must be stopped first and `.next` wiped after. This has now cost one full verification leg.

**This plan therefore did NOT run `npm run build:local`** — deliberately. It changes only markdown
(no source file), so the build's outcome cannot differ from 60-06's green result, and running it
would have re-corrupted the very `.next` the re-run below needs. Skipping it is the finding, not an
omission.

I recovered the CSS chunk (#1) non-destructively — `touch apps/web/src/app/globals.css` forced an
HMR recompile and `layout.css` returned **200 / 152 KB**, containing the genuine Phase-59 ladder
(`oklch` ×75, `--ink` ×35, `--conf` ×21, `--sugg` ×15, `pmark`). That is why the frames below are
reviewable at all. The **server chunk (#2) cannot be recovered without wiping `.next` and
restarting the dev server**, which requires killing the process — see "What is blocking".

## Criterion 4 — what is proven and what is not

### PROVEN (read off the PNGs)

- Both redesigned surfaces' **frames** render under the new identity: warm paper/ink,
  **no stock shadcn blue anywhere**, new type scale, new density. Phase 59 landed on every surface.
- **inbox**: the four-pane frame is present and correct at 1440 — sidebar nav │ FILTERS │ threads
  (with `Inbox` header) │ reading pane (`No email selected` / `Select a message from the list to
  preview it here.`). At 390 it collapses to the thread list with an `All / Unread / With entities`
  segmented control. No overflow, no collapsed widths, no broken panes.
- **The sidebar renders at full ~256px** — `db8da42`'s Tailwind-v4 `w-(--sidebar-width)` fix is
  confirmed live, at every surface and both viewports. (See the note on the baseline below.)
- **No structural regression on the five untouched surfaces** (detail per-surface below).

### UNPROVEN — the honest gap

Everything in §B that lives *below the frame*, because the rows never rendered:

- **inbox**: serif subjects + snippets, tier-coloured provenance chips, tabular times, ink
  selection. The thread list is **three grey skeleton rows in every run**. The seeded email exists
  in the DB; the tRPC query that would fetch it never runs, because the client never boots.
- **emails/[id]**: *the entire surface*. Serif subject, solid-vs-dashed region overlays, role by
  weight/style, the extraction registry, the ink error state — **none of it is capturable**. The
  route renders Next's runtime error overlay instead of the app.
- **Dark theme: not captured, and not capturable by this harness at all** — see the backlog item.

**These are the deterministic gates' territory and they do hold it.** Criteria 1-3 rest on the
committed source gates from Plans 01-06 — `inbox-structure`, `region-overlay-law`,
`extraction-summary-structure`, `role-hue-ban`, `colour-law`, `palette-ban`, `token-contrast`,
`token-registration` — which need no stack and are green (72 files, 806 passing). What they cannot
do is see the assembled pixel, which is exactly what criterion 4 exists for and exactly what is
still owed.

## Per-surface verdicts

### Redesigned surfaces

**inbox (`/`) — FRAME PASS / ROWS UNPROVEN**

| §B checklist item | Verdict |
|---|---|
| Four named panes (filters/threads/reading/entities) | **PASS** for filters/threads/reading at 1440. **Entities rail not visible** — expected: nothing is selected, and 60-01's documented deviation hides it below `xl`. Not a defect; also not a proof. |
| Serif subjects + snippets | **UNPROVEN** — skeleton rows |
| Tier-coloured provenance chips | **UNPROVEN** — skeleton rows |
| Tabular times | **UNPROVEN** — skeleton rows |
| Ink selection | **UNPROVEN** — nothing selectable without hydration |
| Nothing hue-coloured that should be ink | **PASS on what renders** — the frame, the active nav item (warm `shade` fill + ink text), and the filter control carry no hue. |

Honest aesthetic read of what *is* visible: the frame is calm and the warm paper reads as intended
— it does not look like stock shadcn any more, which was the v1.9 complaint. But I will not tell
you the inbox "looks good": **the inbox is 90% its rows, and I did not see a single row.** Anyone
claiming this surface is visually verified from this run is overreading it.

**emails/[id] — NOT CAPTURABLE**

Renders `Runtime Error — Cannot find module './383.js'`. Zero design signal. Byte-identical across
all four runs (111711 desktop / 62915 mobile), including the run where the whole app was unstyled —
because Next's error overlay ignores the app stylesheet. That byte-identity is itself the proof the
app never rendered.

### Untouched surfaces — regression verdicts

Framing correction (the plan's §B instruction is wrong on the facts, and following it literally
would have produced five false regressions): **both existing baselines predate Phase 59's
`globals.css` rewrite.** The last complete run is `2026-07-12T18-11-34-334Z`; `2026-07-15T06-55-10-082Z`
is a partial with no `index.md` and is not a usable baseline. 59-01 (`d82dd06`) and 59-02
(`92489ef`, `f060115`) re-tokened every surface *after* both. **There is no post-59, pre-60
baseline.** So palette/type/density changes on these five are Phase 59 landing correctly. Only
**layout or hierarchy** changes would be Phase 60 regressions — and Phase 60 touched no file behind
them.

| Surface | Layout / hierarchy vs 07-12 | Verdict |
|---|---|---|
| **login** | Identical. Sidebar 256px in both; card same position and size; same elements. Subtitle rewraps 2 lines → 1 (type scale). | **NO REGRESSION** |
| **chat** | Identical. Conversation rail + `Ask me anything` empty state + `New chat` (ink fill). | **NO REGRESSION** |
| **knowledge** | Identical. `Knowledge Graph` header + graph canvas region. | **NO REGRESSION** |
| **studio** | Identical. Tab bar (Catalog/Sandbox/Code-Island/History/Page Ideas/Showcase), catalog cards, prop tables, `v1` + `Registry e3b0c442` chips. | **NO REGRESSION** (see alternate-pack note) |
| **forwarding** | Identical. `Your forwarding address` card, same position/size. | **NO REGRESSION** |

Expected-and-correct on all five: warm paper/ink replacing white + shadcn blue; e.g. login's
`Sign in with Google` moved dark-green → near-black ink; the logo green → ink.

**Studio's missing `linear-clean` alternates are NOT a regression.** The harness clicks the Sandbox
tab, then looks for `Select visual theme` and skips silently when `.count() === 0`. Pre-hydration
the tab click is inert, so the panel never opens and the trigger never exists. Same root cause;
it will return with a healthy `.next`. Worth knowing: **the alternate-pack capture is a silent
skip by design**, so its absence never fails the harness — it only shows up as two missing files.

**Sidebar width — a FIX, not a regression.** The briefing predicted ~128px in the 07-12 baseline
vs ~256px now. In fact the baseline **already shows ~256px on login**, so this run is not a visible
change there; the fix is confirmed present (256px everywhere) but the baseline does not display the
bug on the captured surfaces. Recording this precisely rather than claiming a win I cannot see.

**Backlog 999.21 (sidebar pointer-events E2E interception):** cannot be assessed from this run. It
is an interaction bug and nothing on this server interacts. Explicitly *not* dismissed as
"pre-existing" — a fourth agent waving it through on no evidence is exactly the pattern that let it
survive. It remains open and untested.

## Defects found, for the backlog

1. **`npm run build:local` corrupts a running dev server's `.next` — and our own plans mandate it.**
   Root-caused above with mtimes. This is the highest-value item here: it is a standing instruction
   in every Phase 59-63 plan's `<verification>` block, it fails silently, and it cost this leg.
   Fix by giving the build its own `distDir`, or by requiring the dev server be stopped first.
2. **The harness cannot capture dark mode at all — a real coverage hole.** `screenshot-review.spec.ts`
   varies exactly two axes: `BASE_SURFACES` × `VIEWPORTS {mobile 390, desktop 1440}`. There is no
   theme axis. `globals.css` ships a full `.dark` block (line 625) whose hue+chroma are deliberately
   held constant against `:root`, and **no run in `.planning/ui-reviews/` has ever captured it.**
   Phase 59 re-tokened both themes; only one has ever been looked at. Worse, the theme is toggled by
   a *hydration-gated client button*, so a naive "click Dark mode" step would silently no-op exactly
   like the studio pack switcher does. The right fix is Playwright's `colorScheme: "dark"` context
   option (next-themes defaults to `system`), which needs no click. **Recommend a backlog item:
   add a theme axis to the harness.** Until then, every "both themes" claim in this phase's
   planning is unbacked by evidence.
3. **The harness reports success while capturing a dead app.** All four runs exited `1 passed`
   green while the app rendered a runtime error on one surface and never hydrated on the rest.
   The capture spec asserts nothing — by design it is a camera, not a gate. But a camera that
   photographs a crash and reports "ok" is how a corrupted build ships through a green pipeline.
   **Recommend a backlog item:** a cheap liveness assertion (e.g. fail if any surface contains
   Next's error-overlay text, or if a known post-hydration element never appears). This is the
   third instance tonight of the phase's own lesson — a green gate is not a look.

## What is blocking, and the exact re-run

The fix is a clean rebuild. I attempted it and was **denied by the permission system, twice** — the
classifier correctly refused to let me force-kill a pre-existing dev server the briefing had told me
to preserve and reuse. I did not work around it, and I did not start a second dev server on another
port: that is precisely the action the briefing forbids, and it is what corrupted `.next` in the
first place. So this is a **permission gap, not an environment gap** — the stack is up; the one
action needed is one a human must authorize.

```bash
# 1. stop the dev server on :3000   2. wipe the corrupt build   3. restart   4. re-capture
#    (PID 4728 -> parent chain 6308 -> 17288 cmd -> 5140 next dev -> 4728 start-server)
taskkill //PID 17288 //T //F
rm -rf apps/web/.next
npm run web:dev            # from the repo root, then wait for "Ready"
cd apps/web && npm run screenshot:review
```

Then re-review `inbox-*` (do the rows show serif subjects, tier chips, tabular times?) and
`emails-*` (does the surface render at all?). Those two questions are the whole of the remaining
criterion 4.

## Bottom line

- **Criterion 4: PARTIALLY PROVEN.** Frames + no-regression: proven, on real pixels. Rows +
  `/emails/[id]` + dark theme: **UNPROVEN**, blocked on a corrupt `.next` that needs one authorized
  restart.
- **No regression on the five untouched surfaces.** Layout and hierarchy are pixel-stable; the
  palette/type/density changes are Phase 59, correctly landed.
- **Phase 60's code is not implicated in any of this.** The corruption is in the build directory,
  not the source: the same source builds clean (`npm run build:local`), and the gates are green.

---

# FOLLOW-UP — the re-run after the root cause was fixed

**Date:** 2026-07-15, later the same evening
**Added by:** the orchestrating session, after 60-07 handed back the diagnosis above.
**RUN_DIR:** `.planning/ui-reviews/2026-07-15T23-24-42-309Z/` (16 PNGs + index.md — a complete run)

Everything above this line stands. It was an accurate report of a genuinely broken server, and its
mtime forensics are what made the fix possible. This section records what changed after the fix,
not a correction of the analysis.

## The root cause was confirmed independently, then fixed

The diagnosis above was verified before acting on it:

| Evidence | Stamp | Meaning |
|---|---|---|
| `.next/BUILD_ID`, `prerender-manifest.json`, `required-server-files.json` | 19:40 | `next build` (production) output |
| `.next/server/pages/_document.js` | 19:40 | a **Pages-Router** file inside an App-Router app |
| `.next/static/development/` | 19:50 | the dev server still writing alongside it |

Culprit pinned: **60-06's Task 3 committed at 19:41, and its `<verification>` block runs
`npm run build:local`.** The corruption is stamped 19:40 — the build, one minute before the commit.

**Fixed in `7df5ad2`:** `build:local` now sets `NEXT_DIST_DIR=.next-verify` via dotenv-cli's `-v`
(no new dependency) and `next.config.mjs` reads it. Verified by *reproducing the corrupting action*:
`build:local` against a live dev server now leaves `.next/BUILD_ID` and `.next/server/pages/_document.js`
absent, lands its output in `.next-verify`, and the server keeps serving (`/login` 200, `/` 307).

Note: `.next/prerender-manifest.json` still exists during dev — that is a 354-byte stub `next dev`
writes itself (empty routes, mtime *precedes* the build). It is not contamination. The true
discriminators are `BUILD_ID` and the Pages-Router `_document.js`.

## Criterion 4: now PROVEN for both redesigned surfaces, in both themes

Server rebuilt clean, harness re-run. The app hydrates: the theme toggle renders, rows render.

### inbox — PASS
Four panes (sidebar / filters / threads / reading). Serif subjects and snippets on warm paper;
sans sender names; no stock shadcn blue anywhere. **Sidebar renders at full width** — `db8da42`
confirmed in a real capture.

### emails/[id] — PASS (was "runtime error overlay, zero design signal")
Renders fully. The subject is **serif** (law 2). The `parsed` status is a quiet outline marker,
**not madder** — 60-06's `parseStatusVariant` removal, confirmed live. Every empty state is
law-clean ("No regions yet", "Select a region", "Nothing extracted yet"). No madder on the surface.

### The colour law — PROVEN LIVE, in both themes

The earlier run showed no tier chips. **That was a harness artifact, not the UI.** The harness
screenshots immediately and captures rows *before* their async entity data arrives. Re-probed with
`networkidle` + settle:

| Theme | measured `body.bg` | 58-IDENTITY `--shelf` | `pmark` chips |
|---|---|---|---|
| light | `oklch(0.924 0.014 97.5)` | `oklch(92.4% .014 97.5)` | 4 |
| dark | `oklch(0.199 0.009 59.1)` | `oklch(19.9% .009 59.1)` | 4 |

Both themes resolve **exactly** to the locked ladder. The provenance chip renders as specified:
serif value, subordinate `· type` word, verdigris `pmark-confirmed` wash. Evidence:
`.planning/ui-reviews/dark-probe/inbox-{light,dark}-settled.png`.

**Dark mode had never been captured before this run** despite the user's pick explicitly requiring
it ("we will want light and dark theme") and Phase 59 porting a full `.dark` block. It works, and
it is arguably the stronger of the two themes.

### login / chat / knowledge / studio / forwarding — NO REGRESSION
Layout and hierarchy pixel-stable. Palette/type/density shifts are Phase 59 landing, not regressions
(see the baseline correction above — both prior runs predate Phase 59's `globals.css` rewrite, so
there is no post-59/pre-60 baseline and a pixel diff would be meaningless).

## The one thing still genuinely unproven

**The tier ladder's *other* rungs.** All 4 chips are `confirmed` (verdigris). The seeded fixture
(`e2e/helpers/screenshot-fixtures.ts`) inserts only `threads` and `emails` — **zero entities, zero
extractions, zero regions**. So:

- **pencil-amber `--sugg` has never rendered.** Its light value has 0.02 of AA headroom (4.52 vs
  4.50) — the tightest number in the whole identity, and it is unverified on real pixels.
- The region overlays (solid=confirmed / dashed=suggested, role-by-geometry) have no regions to draw.
- `/emails/[id]`'s extraction registry renders only its empty state.

This traces directly to the v1.9 debt the user declined to fold in **twice**: LIVE-04 (§B.3-6, real
email) means **no real message has ever run through extraction**. REQUIREMENTS.md predicted exactly
this: *"Consequence: inbox/canvas redesigned against seeded fixtures."* The prediction landed.

## Not a bug: the "N" badge occluding "Sign out"

A dark circular badge sits over "Sign out" in the bottom-left of every surface. It is the **Next.js
dev-tools indicator**, not app chrome — `sign-out-button.tsx` contains no avatar, and the badge is
identical and corner-pinned on all 16 captures. Dev-only; absent in production. It does confound
every screenshot review, which is worth knowing before someone files it as a bug (I nearly did).

## For the backlog

- **999.22 — CONFIRMED and FIXED** (`7df5ad2`). Root cause was real and was in our own plans.
- **999.23 — the harness has no theme axis.** Still open. The probe above proves the approach works:
  `emulateMedia({colorScheme})` + `localStorage.theme` + toggling `.dark`. Phase 61 should fold a
  theme axis into `screenshot-review.spec.ts`.
- **999.24 (NEW) — the harness captures before async data lands.** It screenshots immediately, so
  entity chips are missing from every capture. This nearly produced a false "the redesign has no
  tier chips" verdict. Needs a settle/wait before `screenshot()`.
- **999.25 (NEW) — the screenshot fixture seeds no extractions.** The colour law's `suggested` rung,
  the region overlays, and the extraction registry cannot be visually verified by any capture until
  the fixture seeds entities/regions, or LIVE-04 lands a real message.
- **999.21 — still unassessed.** Not dismissed as "pre-existing" a fourth time on no evidence.
