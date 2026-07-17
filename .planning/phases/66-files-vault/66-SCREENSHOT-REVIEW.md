# Phase 66 — /files vault, screenshot review (the first eyes on this surface)

**Reviewed:** 2026-07-17, post-merge, by the orchestrator.
**Run:** `.planning/ui-reviews/2026-07-17T11-04-55-955Z/` — `files-{desktop,mobile}-{light,dark}.png`
**Status of the surface:** wired (`files: filesRouter` in root.ts), bucket `user-files` created and
verified `public: false`, nav entry live, ratchet extended. Suite 85 files / 1073 passing, tsc clean.

Lane D built this without ever rendering it (no dev server in a worktree, jsdom does no layout). Its
SUMMARY said so plainly and named three things a human must look at. This is that look.

## Verdict: it is designed, not generic — with two real flaws, one of which is mine to escalate

### What is right, on real pixels

- **The identity holds in both themes.** Warm paper ground, ink primary, zero stock-shadcn blue.
  The ink button *inverts correctly* in dark (dark fill → light fill) — that is the ladder working,
  not luck.
- **The empty state TEACHES**, exactly as `taste-references.md` §2 demands: *"Drop a file anywhere
  to start your vault"* + an upload affordance. It names the next action instead of announcing
  emptiness. Compare the anti-pattern it dodged: "No files yet."
- **No tree, no details rail.** The planner overrode my briefing here (I said use `@kibo-ui/tree`;
  the taste doc bans a tree without real folder depth, and move/copy is out so a tree earns
  nothing). On the pixels this reads as calm rather than sparse — one pane, not three.
- **Law 1 holds:** nothing on the surface is madder. The only madder in the phase is the delete
  dialog's confirm fill, and the scoped law gate counts it to exactly one file.

### Flaw 1 — "Files / Files" at root (ESCALATED, not fixed)

`page.tsx:33` renders `<h1>Files</h1>` in a 48px bordered title bar; `vault-surface.tsx:271`
renders `<BreadcrumbPage>Files</BreadcrumbPage>` directly beneath it. At the vault root the surface
says its own name twice, 59px apart, and the top bar is otherwise empty.

**Why I did not just fix it:** the title bar is a *cross-surface convention* — Lane D copied the
shape from `knowledge/page.tsx`, and every surface has one. And the duplication only exists at
ROOT: inside a folder the breadcrumb reads `Files / Photos`, which the title bar does not repeat.
So the honest fix is a **design decision about where a route's name lives across the whole app**
(title bar vs. breadcrumb root), not a one-line patch to this file. Making that call unilaterally
at 08:15 while the user is travelling would be exactly the "generic by default" move they are
trying to stop.

**Recommendation when the user weighs in:** the breadcrumb is strictly better — it names the
location *and* navigates, and it is already the only element that stays correct at depth. The
title bar's h1 should become `sr-only` (keeping the a11y landmark) and the bar itself should either
carry the surface's actual controls or disappear. That is ~5 lines per surface and should be a
Phase 62 sweep item, since 62 already owns /knowledge, /studio, /settings and /login.

### Flaw 2 — the empty card is a large dead box

The empty state is a ~280px-tall bordered card with its content floating in the middle and ~500px
of dead page beneath it. It does not read as *centered-card-with-shadow syndrome* (there is no
shadow, and the border is `border-rule`, not a stock outline) — but it is a big empty rectangle
whose only job is to hold one sentence and one button. `taste-references.md` §6's anti-generic list
warns about exactly this shape.

**Not fixed, deliberately:** the same card is the container the *populated* vault renders rows
into, so its height is not empty-state-specific and shrinking it would be styling the empty case at
the populated case's expense. The right test is a vault with 20 files in it — which needs the
fixture work below.

## What is still unproven, plainly

- **Every capture is the EMPTY state.** The bucket was created minutes ago and contains nothing, so
  no row, no breadcrumb-at-depth, no upload progress, no drag-accept, no delete dialog has been
  seen by anyone. The three things Lane D's SUMMARY asked a human to look at — the drag-accept
  (rise vs. strobe), the empty state (teaching vs. lonely card), and dark-mode madder — only the
  last two are answerable from these frames.
- **This is 999.24/999.25's shape again**, one surface later: the harness photographs whatever
  state the fixture leaves, and an unseeded fixture means the interesting surface is invisible. The
  inbox needed a seeded email; the chat needed a seeded turn; the canvas needed a seeded layout.
  **The vault needs a seeded file tree** — `seedVaultFixture()` alongside `seedChatThreadFixture`,
  uploading 3-4 objects and a nested folder to `{userId}/`. Until then "the vault renders" means
  "the vault's empty state renders."
- **Nothing here proves upload works.** The procedures are unit-tested against a mocked storage
  client; the real bucket has never received a byte through the UI.

## Recorded for the backlog

- **999.37 — seed the vault fixture** so the populated surface, upload progress, drag-accept and
  the delete dialog enter the capture record. Same pattern as `seedChatThreadFixture`.
- **999.38 — route-name duplication across surfaces** (flaw 1). Phase 62 sweep candidate.
