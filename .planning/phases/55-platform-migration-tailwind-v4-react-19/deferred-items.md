# Deferred Items — Phase 55

Out-of-scope discoveries logged during plan execution, per the executor's SCOPE BOUNDARY rule
(only auto-fix issues directly caused by the current task's changes).

## 55-02: token-render.spec.ts `/knowledge` test — pre-existing click-interception failure

**Found during:** 55-02 Task 1's elevated-blast-radius regression gate
(`npm run test:e2e -w @polytoken/web --grep "token-render"`).

**Symptom:** `e2e/token-render.spec.ts`'s `/knowledge: minimap container, a graph node, and the
React Flow Controls icon fill all resolve` test times out (60s) on
`page.locator("label", { hasText: "Knowledge Rules" }).click()` — Playwright reports
`<div data-sidebar="content" ...> subtree intercepts pointer events`, i.e. the app sidebar's
scrollable nav content is capturing the click intended for the `/knowledge` filter rail's
"Knowledge Rules" checkbox label.

**Root-cause isolation performed:** Fully reverted all 5 of 55-02 Task 1's files (globals.css +
the 4 neutralized JS configs) back to their exact 55-01 (pre-Task-1, still-HSL/`@config`-bridge)
committed state, then re-ran this exact test in isolation. **The identical failure reproduced on
the unmodified baseline** — confirming this is a pre-existing bug in the test spec's own
interaction sequence (or the `/knowledge` filter-rail/sidebar layering it depends on), not a
regression introduced by the oklch/`@theme`/`@source` port. All 55-02 Task 1 changes were then
restored (`git diff --stat` confirms byte-identical to pre-revert state).

**Why this was never caught before:** `token-render.spec.ts` was authored in 55-01, but Docker
was unreachable in that session (`BLOCKED-ENVIRONMENT`, per 55-01-SUMMARY.md) — this 55-02
session is the first time this spec has ever actually executed against a live browser.

**Supporting evidence this is NOT a color/token regression:** the sibling `/` (inbox) and `/chat`
(canvas) token-render tests both pass cleanly against 55-02's Task 1 changes, exercising the same
`assertRealColor` computed-style assertions across `bg-background`, `text-foreground`, the
`bg-sidebar` family, and the React Flow attribution chrome — all real, non-transparent colors
resolve correctly post-oklch-port.

**Disposition:** Deferred — out of 55-02's scope (not caused by this plan's changes). Needs a
fresh investigation into the `/knowledge` filter-rail's DOM layering / the seeded test fixture's
sidebar-expansion state in a follow-up session, independent of the Tailwind v4 migration.

**55-04 update:** Same exact failure signature (`data-sidebar="content"`/`data-sidebar="menu"`
under `data-side="left"` intercepting pointer events, deterministic 60s timeout after 80-100+
retries) reproduces identically on React 19 — confirmed via isolated re-run
(`npx playwright test e2e/token-render.spec.ts --project=chromium` from `apps/web`) both inside
the full parallel suite and standalone. 55-04's Task 1/Task 2 changes never touch
`packages/ui/src/sidebar.tsx` (confirmed: `git diff --stat` for this plan's commits shows zero
changes to that file) — this is the same pre-existing sidebar-layering bug, not a React-19
regression. `uat-48-token-surfaces.spec.ts`'s "48.1: citation chip resolves the fully-rounded
pill radius; confirm/deny controls render distinct success/destructive colors" test exhibits the
identical signature on a different page (`/emails/[id]`'s layers-panel `[role="treeitem"]`, also
intercepted by `data-sidebar="menu"` under `data-side="left"`) — same root-cause class, added to
this entry rather than opening a new one.

`npm run screenshot:review -w @polytoken/web` (55-04 Task 2) hit the same bug a third time: after
successfully capturing 5 of 6 base surfaces (login/inbox/chat/knowledge/studio x mobile+desktop =
10 PNGs, plus one successful `studio-mobile-linear-clean.png` alternate-pack capture), the run
timed out (300s) on `captureAlternatePackIfPresent`'s `Sandbox` tab click for the `studio`
surface — same `data-sidebar="menu"` under `data-side="left"` intercepting the click, same
retry-then-timeout pattern (505 retries before giving up). This is now confirmed across THREE
independent interaction contexts (a sidebar nav-rail label, an email-detail layers-panel
treeitem, and a Studio-page tab trigger) — strong evidence this is a systemic, pre-existing
sidebar pointer-events/z-index issue affecting any click near the expanded left sidebar, not a
narrow test-specific flake. The 11 screenshots that WERE captured (spot-checked visually:
chat-desktop.png, knowledge-desktop.png) show fully correct, non-regressed rendering — colors,
layout, and the React Flow knowledge-graph canvas all render as expected on React 19.
`.planning/ui-reviews/2026-07-15T06-55-10-082Z/` is the resulting partial-but-real capture
artifact.

**55-05 update:** Re-ran `npm run test:e2e -w @polytoken/web` twice this session (once after the
react-day-picker v9 + react-resizable-panels v3 bumps, once again after removing 55-04's now-
redundant root `overrides` pin) — identical failure signature both times: `token-render.spec.ts`'s
`/knowledge` case and `uat-48-token-surfaces.spec.ts`'s 48.1 case fail with the same
`data-sidebar="menu"`/`"content"` under `data-side="left"` pointer-events-interception timeout;
`live-loop-green.spec.ts` and `uat-39-tool-round.spec.ts` fail because no local FastAPI listener
was running (both are documented operator prerequisites, not something the spec starts itself).
38 passed / 8 failed / 4 did not run, matching 55-04's exact documented baseline. Neither of
55-05's commits touches `packages/ui/src/sidebar.tsx` or any FastAPI/listener code — confirmed
non-regression, not re-investigated further (out of this plan's scope, per SCOPE BOUNDARY).

## 55-02: `packages/genui` `artifacts.test.ts` registryVersion hash drift — pre-existing

**Found during:** 55-02 Task 2's `npm run test -w @polytoken/genui` gate (run to confirm the
`themed-wrapper.tsx`/`tokens.ts` edits didn't regress the genui suite).

**Symptom:** `src/generation/__tests__/artifacts.test.ts`'s committed-vs-fresh
`buildGenuiPromptPayload()` snapshot comparison fails on a `registryVersion.version` hash
mismatch (committed `eaaf8d3e...` vs freshly computed `2562c1fb...`) — unrelated to color/CSS
content; this is a content-hash of the genui component catalog/registry payload sent to Bedrock.

**Root-cause isolation performed:** `git stash`'d all 3 of 55-02 Task 2's `packages/genui/src/theme`
file changes (`themed-wrapper.tsx`, `tokens.ts`, `__tests__/themed-wrapper.test.tsx`) and re-ran
this exact test in isolation against the untouched baseline. **The identical failure reproduced**
— confirming this hash drift pre-exists this plan's changes entirely (not caused by the
`hsl(...)`-wrapping fix or the comment rewording). All 3 files were then restored via
`git stash pop` (`git diff --stat` confirms byte-identical to pre-stash state).

**Disposition:** Deferred — out of 55-02's scope (not caused by this plan's changes; unrelated
to STCK-01's oklch/`@theme`/`@source` surface entirely). The committed `GENUI_PROMPT_PATH`
artifact needs regenerating in a follow-up session against whatever change in the catalog/
registry actually drifted it (not diagnosed here — orthogonal to this plan).
