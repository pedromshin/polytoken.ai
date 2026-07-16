---
phase: 61-surface-redesign-chat-canvas-mobile-panel-chrome
plan: 01
subsystem: verification-instruments
tags: [playwright, geometry-gate, screenshot-harness, theme-axis, tailwind-v4, mobile]
requires:
  - "a dev server already serving :3000 (this gate never starts one)"
  - "the local Supabase stack (GoTrue admin seeding, T-61-01)"
provides:
  - "npm run test:geometry — the rendered-geometry gate (61-03..61-07 and Phases 62-63 inherit it)"
  - "playwright.geometry.config.ts — a config structurally unable to spawn a second next dev"
  - "screenshot:review surface x viewport x THEME captures, with a per-capture settle record"
affects:
  - "apps/web/playwright.config.ts (testIgnore widened — test:e2e must never run the gate)"
  - "apps/web/src/app/chat/page.tsx (mobile height budget fix, found BY the gate)"
tech-stack:
  added: []
  patterns:
    - "rendered-geometry assertions in a real browser against the ALREADY-RUNNING dev server"
    - "no-webServer config as a structural mitigation, not a discipline"
    - "assert the applied theme, never trust the lever that applied it"
    - "settle degrades and records; theme mislabelling throws"
key-files:
  created:
    - apps/web/playwright.geometry.config.ts
    - apps/web/e2e/surface-geometry.spec.ts
    - .planning/phases/61-surface-redesign-chat-canvas-mobile-panel-chrome/deferred-items.md
  modified:
    - apps/web/e2e/screenshot-review.spec.ts
    - apps/web/playwright.config.ts
    - apps/web/package.json
    - apps/web/src/app/chat/page.tsx
decisions:
  - "D-61-01-A: the geometry config declares NO webServer and the file is kept literally free of the option's name, so the zero-occurrence check is total"
  - "D-61-01-B: /chat's mobile height bug found by the gate was FIXED, not deferred — weakening a gate to dodge a true red is the anti-pattern the plan forbids"
  - "D-61-01-C: the settle waits on BOTH [aria-busy=true] and [class*=animate-pulse]; aria-busy alone would have missed the inbox, the surface that motivated 999.24"
metrics:
  duration: ~50 min
  completed: 2026-07-16
  tasks: 2
  commits: 4
---

# Phase 61 Plan 01: The Rendered-Geometry Gate & The Harness's Two New Senses — Summary

Built the two instruments this phase's verification depends on: a real-browser geometry gate that
reproduces tonight's rail bug to the pixel (11,296px) and **caught a second, unknown layout bug on
its first run**, plus a capture harness that photographed dark mode for the first time in this
project's history and now waits for data before the shutter.

## What was built

| Artifact | What it does |
|---|---|
| `apps/web/playwright.geometry.config.ts` | Runs the gate with **no server-spawning block** — cannot corrupt `.next` (T-61-03/999.22) |
| `apps/web/e2e/surface-geometry.spec.ts` | No-document-scroll at 390+1440, scroll-containment for rail + transcript, hydration proof, local-only seeding |
| `apps/web/package.json` | `test:geometry` script |
| `apps/web/playwright.config.ts` | `testIgnore` widened so `test:e2e` can never run the gate under a webServer config |
| `apps/web/e2e/screenshot-review.spec.ts` | Theme axis (999.23) + real settle (999.24), both recorded in `index.md` |
| `apps/web/src/app/chat/page.tsx` | **Deviation** — mobile height budget fix, found by the gate |

**The exact invocation** (61-03..61-07 and Phases 62-63 inherit this):

```bash
cd apps/web && npm run test:geometry     # NEVER a bare `npx playwright test` (T-61-03)
```

**Exported constants** (`e2e/surface-geometry.spec.ts`):

| Constant | Value | Why |
|---|---|---|
| `SCROLL_EPSILON_PX` | `2` | Sub-pixel rounding only. The failure mode is orders of magnitude (11,296 vs 900), not a pixel |
| `MOBILE_VIEWPORT` | `{ width: 390, height: 844 }` | Mirrors `screenshot-review.spec.ts` — the gate measures what the reviewer looks at |
| `DESKTOP_VIEWPORT` | `{ width: 1440, height: 900 }` | ″ |
| `SCROLL_AREA_VIEWPORT_SELECTOR` | `[data-radix-scroll-area-viewport]` | The real scroller inside a Radix ScrollArea; the product code keys on it too (`message-list.tsx:85`) |

## The negative proof — RED output, verbatim

Removed `className="h-full"` from the `<Collapsible>` in `conversation-rail.tsx` (~line 189), then
ran `npm run test:geometry`:

```
Running 3 tests using 1 worker

  x  1 [chromium] › e2e\surface-geometry.spec.ts:303:3 › rendered-geometry gate: /chat (SURF-02, 61-01) › does not scroll its document at the desktop viewport (1440x900) (2.5s)
  -  2 [chromium] › e2e\surface-geometry.spec.ts:312:3 › rendered-geometry gate: /chat (SURF-02, 61-01) › does not scroll its document at the mobile viewport (390x844)
  -  3 [chromium] › e2e\surface-geometry.spec.ts:321:3 › rendered-geometry gate: /chat (SURF-02, 61-01) › the rail and the transcript scroll INSIDE themselves (1440x900)


  1) [chromium] › e2e\surface-geometry.spec.ts:303:3 › rendered-geometry gate: /chat (SURF-02, 61-01) › does not scroll its document at the desktop viewport (1440x900)

    Error: /chat @ 1440x900: the DOCUMENT scrolls, so a height chain is broken. Expected documentElement.scrollHeight <= 902 (innerHeight 900 + 2px sub-pixel epsilon), got 11296. (body.scrollHeight 11296.) /chat's root is "flex h-svh flex-col", so any element between it and a ScrollArea that grows to CONTENT instead of being bounded by its parent produces exactly this — see e2a2abf (Radix <Collapsible> given no className renders a bare unstyled <div> and grew to ~11,296px at a 900px viewport).

    expect(received).toBeLessThanOrEqual(expected)

    Expected: <= 902
    Received:    11296

  1 failed
  2 did not run
```

**`Received: 11296`** — the gate reproduces `e2a2abf`'s original 11,296px exactly. Restored the
class; `git diff --stat -- apps/web/src/app/chat/_components/conversation-rail.tsx` is **empty**;
all 3 tests green again. The proof edit left no trace in the committed tree.

## The gate caught a real bug on its first run (Rule 1 deviation)

Before any negative proof, the gate's first honest run went RED at mobile:

```
Error: /chat @ 390x844: the DOCUMENT scrolls, so a height chain is broken. Expected
documentElement.scrollHeight <= 846 (innerHeight 844 + 2px sub-pixel epsilon), got 888.
(body.scrollHeight 888.)
```

Not flake — exact arithmetic:

- `SidebarInset` renders `<main className="relative flex min-h-svh flex-1 flex-col">`
- `layout.tsx:74` renders a **44px** (`h-11`) `md:hidden` header ABOVE `{children}` inside it
- `ChatPage`'s root claimed the whole viewport with a bare `h-svh` (844px)
- **44 + 844 = 888**

Below `md`, `/chat` assumed it owned a viewport it does not own: the whole page sat 44px past the
fold. At `md`+ the shell header is hidden and `h-svh` is exactly right — which is why every
desktop check ever run missed it, and why **806 green tests were green before and after the fix**.

Fixed in `chat/page.tsx` as a responsive pair (`h-[calc(100svh-2.75rem)] md:h-svh`), leaving the
`md`+ path byte-identical. Committed separately (`733db3e`) from the instrument.

**Why fixed rather than deferred:** the plan requires `test:geometry` green at both viewports, and
every plan 61-03..61-07 runs it. A gate that ships RED on a known bug teaches its readers to
ignore it. Weakening the assertion to dodge a true red is precisely the anti-pattern the plan
forbids ("fix the gate, do not weaken the proof"). The fix is one class on the one route making
the false assumption; a shell-wide fix in `layout.tsx` would touch every route and is Rule 4
(architectural) — not taken unasked.

## Theme axis (999.23) — verified

Dark mode is on disk for the first time. Run `.planning/ui-reviews/2026-07-16T00-44-36-677Z/`:

| | count |
|---|---|
| total PNG | **32** (was 16) |
| light | 16 |
| dark | **16** — previously 0, for the project's entire history |
| studio alternate pack | 4 |

Theme is the outermost loop with one page per theme (`addInitScript` is per-page and cannot be
unregistered, and must land before next-themes' pre-mount script — a post-`goto` write needs a
reload and is a race). Both levers applied (`emulateMedia({colorScheme})` + `localStorage.theme`),
then the result **asserted** against `<html>.dark`. The assertion throws where the settle degrades:
a mislabelled frame reads as evidence and is worse than no axis at all. It discriminated correctly
across all 32 captures (light saw no `.dark`, dark saw it).

`inbox-desktop-dark.png` read visually (a proxy gate is not a proof, per 61-CONTEXT): genuinely
dark `--shelf`, ink chrome, serif evidence, entity chips present. Filenames keep `light` explicit
(`chat-desktop-light.png`), pack suffix still composes (`studio-desktop-dark-linear-clean.png`).

## Settle (999.24) — verified

The fixed 400ms is gone. Every capture now waits for network idle **and** for every skeleton to
leave the DOM, both bounded and non-fatal, with the outcome recorded per row in `index.md`
(`settled` vs `NOT settled (captured anyway) — …`). All **32/32 rows recorded `settled`**.

`inbox-mobile-light.png` — the frame that previously photographed as three grey skeleton rows and
nearly produced a false "the redesign has no tier chips" verdict — now shows the real feed: 7 rows,
serif evidence, and visible entity chips (`UAT-39 Invoice Fixture`, `UAT-48 Fixture Type`).

**The skeleton selector needed the call sites read, not assumed.** `[aria-busy="true"]` alone —
the plan's own worked example — would have missed the inbox entirely: its loading block is
`<div aria-hidden>` (`inbox-three-pane.tsx:384`) with **no `aria-busy` at all**. And `Skeleton`
applies `motion-safe:animate-pulse`, which Tailwind v4 emits as that literal class, so a
`.animate-pulse` selector matches nothing. The selector is therefore
`[aria-busy="true"], [class*="animate-pulse"]` — already this codebase's own idiom
(`genui-part-boundary.test.tsx:80`). Waiting on `aria-busy` alone would have "fixed" 999.24
everywhere except the surface it was found on.

**The `networkidle` claim was re-checked, and it is FALSE.** The old header asserted networkidle
was "deliberately avoided" because Next dev's HMR websocket keeps its connection open
indefinitely. Against the current stack it is reached on **32/32 captures**, and the geometry gate
reaches it on `/chat` in ~2-3s per navigation (Playwright's networkidle ignores long-lived
websockets). It is now used — bounded and non-fatal — and whether it was actually reached is
recorded per capture, so the claim keeps re-checking itself instead of resting on a comment. The
header now states what was observed.

## Deviations from Plan

### 1. [Rule 1 — Bug] `/chat` mobile height budget: the 44px shell header

- **Found during:** Task 1, the gate's first run
- **Issue:** `documentElement.scrollHeight` 888 at an 844px viewport — `h-svh` claimed a viewport
  the route does not own below `md` (44px `md:hidden` shell header sits above it)
- **Fix:** `h-[calc(100svh-2.75rem)] md:h-svh` in `apps/web/src/app/chat/page.tsx`
- **Files modified:** `apps/web/src/app/chat/page.tsx`
- **Commit:** `733db3e`
- **Regression check:** 72 files / 806 tests green (unchanged baseline); gate green at both viewports

### 2. [Rule 3 — Blocking] Task 1's verify greps for zero `webServer` occurrences, but its action asks the header to explain the absence

- **Issue:** the plan's action says "Say why in the file header, naming 999.22" — naming the
  option — while its verify asserts `grep -c "webServer" playwright.geometry.config.ts` is `0`.
  Mutually exclusive as literally written.
- **Resolution:** honored the **verify**. The header explains the absence in full prose without
  ever spelling the option's literal name, so the file is greppably free of it in code AND
  comments. This makes the zero-occurrence invariant total — no "it's only in a comment"
  reasoning, and a check that also catches a commented-out block being uncommented later. Intent
  (no server-spawning block, documented reasoning) is fully preserved.

### 3. [Rule 1 — Bug, in the plan's own verification] Task 2's verify passed for the wrong reason

- **Issue:** the plan's verify resolves the newest run with `readdirSync(...).sort().pop()`. A
  leftover `.planning/ui-reviews/dark-probe/` from tonight's throwaway probe sorts AFTER every
  `2026-…` ISO timestamp (`"d" > "2"`), so the command reported `dark-probe dark frames: 2` and
  **passed while reading the probe's frames, not the run's 16.**
- **Resolution:** re-verified with an ISO filter (`/^\d{4}-/`), which found the real run (32 PNGs,
  16 dark). Logged as a hazard in `deferred-items.md` (D-61-01) because Plans 61-03..61-07 and
  Phases 62-63 all review these captures and any sort-based "newest run" lookup will silently read
  5 stale probe PNGs from a different night.
- **Not actioned:** deleting the user's untracked debugging artifacts unasked is not this
  executor's call. Fix is one `rm -rf` + an ISO filter; both recommended in `deferred-items.md`.

### 4. [Scope] Auto-generated drift left unstaged

`apps/web/tsconfig.json` and `apps/web/next-env.d.ts` are dirty in the working tree (Next rewrote
them to point at `.next-verify`, a `build:local` side effect — `7df5ad2`). Generated files, outside
this plan's `files_modified`, **not staged**. Logged as D-61-02.

## Threat model compliance

| Threat | Disposition |
|---|---|
| T-61-01 (EoP — seeded service_role session) | `isLocalTarget` reimplemented **locally** in `surface-geometry.spec.ts`, never imported from `screenshot-review.spec.ts`; both hosts must be local; unparseable URL fails closed; non-local `test.skip()`s rather than measuring a `/login` redirect |
| T-61-02 (info disclosure — capture artifacts) | `git check-ignore` verified on a new dark frame -> `.planning/ui-reviews/.gitignore:2:*.png`. `git ls-files` confirms **no PNG tracked**. No PNG committed, no rendered address/token pasted here |
| T-61-03 (tampering — `apps/web/.next`) | Config declares no server-spawning block and contains zero occurrences of the option's name; `playwright.config.ts` `testIgnore` widened so `test:e2e` cannot run the gate under a webServer config; never ran a bare `npx playwright test`; dev server confirmed alive (`/chat -> 307`) and gate green after `build:local` |
| T-61-SC (supply chain) | No packages installed. `@playwright/test`, `dotenv`, `pg` already present |

## Verification

| Check | Result |
|---|---|
| `cd apps/web && npx tsc --noEmit` | clean |
| `cd apps/web && npm run test:geometry` | **3 passed** against the live :3000 server |
| `cd apps/web && npm run screenshot:review` | **1 passed** (1.4m) — 32 PNGs, 16 light + 16 dark |
| `cd apps/web && npx vitest run` | **72 files / 806 passed**, 2 skipped — matches the 60-07 baseline |
| `cd apps/web && npm run build:local` | clean (`.next-verify`); dev server survived |
| `test:geometry` script exists | PASS |
| zero `webServer` in geometry config | PASS |
| `playwright.config.ts` ignores the gate | PASS (regex-verified: gate + capture ignored, 3 assertion specs still run) |
| Negative proof RED, then restored clean | PASS — 11296, empty diff |

## Success criteria

- [x] **A broken height chain on `/chat` turns a committed gate RED — proven, not asserted.**
      11,296px, reproduced exactly, output pasted above.
- [x] **The gate cannot spawn a second `next dev`, by construction rather than by discipline.**
      No server-spawning block; the option's name does not occur in the file at all.
- [x] **Dark mode has been photographed.** 16 dark frames, labelled correctly, theme asserted
      per-capture rather than trusted; one read visually to confirm the proxy.
- [x] **A capture that shot too early is distinguishable in `index.md` from a surface that has no
      chips.** Per-row settle column; 32/32 `settled`; `inbox-mobile` now shows its real feed.

## Notes for later plans

- **Run the gate as `npm run test:geometry`.** Never a bare `npx playwright test` (T-61-03/999.22).
- **The gate needs a dev server already on :3000.** It will not start one — that is the design.
- **Extending it to new surfaces:** the two assertion helpers (`assertDocumentDoesNotScroll`,
  `assertScrollsInternally`) take a `Page`/`Locator` and are surface-agnostic. Locators are keyed
  on semantics (the seeded conversation row, the composer's placeholder), NOT on classes, so a
  61/62/63 restyle should not silently repoint them at the wrong box.
- **999.25 still open** and untouched — the settle did NOT make `--sugg` reachable (captured chips
  are seeded entity regions, not suggestions). Flagged for Phase 62 as the plan asked.
- **Watch `dark-probe`** (D-61-01) before trusting any "latest run" capture review.

## Self-Check: PASSED
