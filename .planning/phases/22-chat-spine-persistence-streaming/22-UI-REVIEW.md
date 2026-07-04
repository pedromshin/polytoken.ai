# Phase 22 — UI Review

**Audited:** 2026-07-03
**Baseline:** `.planning/phases/22-chat-spine-persistence-streaming/22-UI-SPEC.md` (design contract, status: draft/pending sign-off)
**Screenshots:** not captured — no dev server detected on :3000/:5173/:8080; this is a **code-only audit** against the 27 source files under `apps/web/src/app/chat/` plus the shared `@nauta/ui` primitives they consume (`button.tsx`, `badge.tsx`, `skeleton.tsx`) and the Python model registry (`chat_model_registry.py`) that feeds the model picker's copy.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Nearly every specced string matches verbatim (empty states, error cards, delete dialog, aria-labels), but the browser-model entry's specified caption ("Runs in your browser · no server cost, no genui") was never implemented — the generic `best_for` line stands in for it instead. |
| 2. Visuals | 3/4 | All icon-only controls carry proper `aria-label`s and always-visible (non-hover-gated) affordances per the a11y contract; hierarchy is undercut by the same Label-weight inconsistency noted in Typography. |
| 3. Color | 2/4 | Toolbar background omits the spec's declared muted/frosted treatment; the streaming caret — explicitly named as a reserved-accent element — renders in plain foreground color instead of `text-primary`; accent color leaks onto two elements (markdown links, WebLLM "Ready" dot) outside the spec's closed "reserved for" list. |
| 4. Typography | 3/4 | Capability rows and per-turn cost-breakdown figures correctly apply the declared Label-role `font-semibold`, but the session cost-meter figure and rail row timestamps — both explicitly named under the same Label role — render at default weight, an internally inconsistent application of the declared 2-weight system. |
| 5. Spacing | 4/4 | The 4/8/16/24/32/64 scale is followed with high discipline everywhere, including both documented exceptions (44px touch targets, 44px/208px textarea); only trivial 2px (`py-0.5`/`gap-0.5`) icon-row micro-spacing falls outside the strict token set. |
| 6. Experience Design | 3/4 | Loading/error/empty/disabled/destructive-confirm states are all genuinely present and correctly wired (not just stubbed), but the shared `Skeleton` primitive's `animate-pulse` is never `motion-safe:`-gated — violating the spec's own explicit reduced-motion contract for "skeleton pulse" — and a WebLLM turn-persistence failure is silently swallowed via `console.error` with no user-facing signal. |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **Streaming caret doesn't use the reserved accent color** — `apps/web/src/app/chat/_components/message-turn.tsx:137` renders the blinking `▍` tail caret as `text-foreground motion-safe:animate-pulse`, but 22-UI-SPEC.md's Color table explicitly reserves accent for "streaming caret/cursor." As shipped, the one visual signal that most needs to read as "live, in-progress, on-brand" looks identical to static text — a real, easily-missed hierarchy loss during every single streaming turn. **Fix:** change `text-foreground` to `text-primary` on that span.

2. **Skeleton pulse animates under `prefers-reduced-motion`, contradicting the phase's own accessibility contract** — `packages/ui/src/skeleton.tsx:11` bakes in a bare `animate-pulse` (no `motion-safe:` gate), and every phase-22 skeleton usage inherits it: `RailSkeleton` (`conversation-rail.tsx:37`) and the genui `SkeletonBars` (`genui-part-boundary.tsx:76-79`). 22-UI-SPEC.md's Accessibility section explicitly lists "skeleton pulse" as one of exactly three things that must render in their end state under reduced motion — two of the three (rail-collapse transition, streaming-caret blink) are correctly gated; this one is not, because it lives in a shared pre-existing primitive nobody touched. **Fix:** wrap the base class in `motion-safe:animate-pulse` in `skeleton.tsx` (a one-line, app-wide fix, not chat-specific).

3. **Toolbar background omits the spec's declared muted/frosted treatment** — the `ConversationView` toolbar (`page.tsx:461`, `<div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-4">`) has no background class at all, so it renders on the dominant (60%) canvas color. 22-UI-SPEC.md's Color table explicitly lists "toolbar background" under the Secondary (30%) `bg-muted` / frosted role — as shipped, the model picker + cost meter bar is visually indistinguishable from the message canvas behind it, undercutting the 60/30/10 split the spec is built around. **Fix:** add `bg-background/70 backdrop-blur-md` (matching the rail's own frosted treatment) or `bg-muted/40` to the toolbar wrapper.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Verified exact matches (evidence of real compliance, not assumed):**
- Empty-state heading/body: `chat-home-empty-state.tsx:30-36` — "Start a new conversation" / "Ask the agent anything — responses stream in and can include interactive widgets." — byte-for-byte match to the Copywriting Contract.
- Failed-turn error: `inline-error-card.tsx:31` — "Something went wrong generating this response." + Retry button, `role="alert"`.
- Cost-cap block: `cost-cap-blocked-card.tsx:20-26` — both lines match verbatim, including the deliberate absence of a Retry action.
- Status badges: `turn-status-badge.tsx:30,37` — "Stopped by user" / "Cost-capped · partial response" exact.
- Delete dialog: `delete-conversation-dialog.tsx:42-57` — title, body (with correct `"{title}"` interpolation and smart-quote escaping), Cancel="Keep conversation", Confirm="Delete" — all exact.
- Rename placeholder: `inline-rename-field.tsx:13` — "Untitled conversation" exact.
- All icon-only aria-labels present and correct: "Send message"/"Stop generating" (`composer.tsx:92`), "Regenerate response" (`turn-action-row.tsx:69`), "Copy response" (`turn-action-row.tsx:56`), "Jump to latest message" (`jump-to-bottom-button.tsx:25`), and the rail overflow trigger's dynamic `` `More actions for ${conversation.title}` `` (`conversation-row.tsx:104`) — this directly resolves the earlier non-blocking recommendation about the rail overflow trigger's aria-label.
- Model-picker capability row honesty (D-05): `model-picker-entry.tsx:43-52`'s `formatCapabilityRow` never omits a flag; verified against the registry's Gemma-2-27B entry (`tools=false, genui=false`) — renders "Tools ✗ · GenUI ✗ (text only) · 8K ctx" exactly per the spec's own worked example.

**Gap found:**
- **Browser-entry caption not implemented as its own string.** 22-UI-SPEC.md's Copywriting Contract specifies, verbatim, for the WebLLM entry: `Badge: "Local · Free"; caption "Runs in your browser · no server cost, no genui"`. `model-picker-entry.tsx:121-124` renders the `"Local · Free"` badge correctly, but the caption slot is never populated with the specified string — the only text below it is the generic `Best for: {model.bestFor}` line (`model-picker-entry.tsx:130-132`), which reads from `chat_model_registry.py:141`: `"Runs entirely on-device via WebGPU: private, free, no server round-trip."` — a different sentence that (importantly) never says "no genui," the one honesty-critical phrase the spec's literal caption called out. The capability row elsewhere does convey `GenUI ✗`, so this isn't a silent capability lie, but it is a concrete content-contract miss, not a discretionary rewording.

### Pillar 2: Visuals (3/4)

- Clear focal point on the chat-home landing state: centered icon + `text-2xl font-semibold` heading + body + CTA (`chat-home-empty-state.tsx:25-47`), correctly larger/more prominent than the rail's own `size="sm"` New-chat button per D-13.
- Every icon-only button in the surface (Send/Stop morph, rail overflow, copy/regenerate, sibling-nav prev/next, jump-to-bottom, rail collapse toggle) carries a correct `aria-label` — confirmed by direct inspection of all 9 icon-only controls in the tree, not sampled.
- No hover-only affordances found anywhere: the rail's `MoreHorizontal` trigger (`conversation-row.tsx:98-109`) and `TurnActionRow`'s copy/regenerate row (`turn-action-row.tsx:52-86`) are unconditionally rendered, never gated behind a `group-hover:` class — this correctly satisfies the UI-SPEC's explicit "no hover-only affordances" rule.
- Visual hierarchy is present (Display 24px empty-state heading > Heading 16px semibold toolbar/entry names > Body 14px turn text > Label 12px meta) but is diluted by the same Label-role inconsistency documented under Typography below — timestamps and the cost-meter figure sit at the same visual weight as ordinary body text instead of the intended lighter/tighter Label treatment, so the rail's scannability (title vs. timestamp) is slightly flatter than specced.

### Pillar 3: Color (2/4)

**Confirmed correct (the majority of the contract):**
- Active rail row: `bg-primary/10 text-primary` (`conversation-row.tsx:67`) — exact match, correct 10%-accent usage.
- Send button: default `variant="default"` → `bg-primary` via the shared `Button` component — correct, only on the one specced element.
- Recommended badge: `border-primary text-primary` outline (`model-picker-entry.tsx:103`) — exact match.
- Stop button stays neutral (`variant="secondary"`, `composer.tsx:89`) — correctly never accent, matching the "Never applied to: Stop button" rule.
- Rail frosted chrome: `border-r border-border/50 bg-background/70 backdrop-blur-md` (`conversation-rail.tsx:111`) — exact match to `AppSidebar`'s treatment as required.
- No hardcoded hex/`rgb()` colors anywhere in `apps/web/src/app/chat/` (grep returned zero matches) — all color is token-bound Tailwind classes.

**Gaps found:**
- **Toolbar background missing** — see Top 3 Fix #3 above (`page.tsx:461`).
- **Streaming caret not accent-colored** — see Top 3 Fix #1 above (`message-turn.tsx:137`, `text-foreground` instead of `text-primary`).
- **Accent color used outside the spec's closed "reserved for" list**, in two places not authorized by the Color contract's enumerated 5-item list (Send button / active row / streaming caret / Recommended outline / focus rings):
  - Markdown-rendered hyperlinks: `markdown-renderer.tsx:72`, `className="text-primary underline"`.
  - WebLLM "Ready" indicator dot: `model-picker-entry.tsx:96`, `className="size-1.5 rounded-full bg-primary"` (a defensible substitute for the spec's literal "green dot," since no green/warning token exists in this palette — but still an un-enumerated accent use, worth a checker sign-off decision either way).
  These are individually minor, but three separate un-authorized/mis-colored accent touchpoints (caret, links, ready-dot) plus one missing 30%-tier surface (toolbar) is a real pattern, not an isolated nit — the "reserved, restrained accent" discipline the spec is built around is not being enforced consistently.

### Pillar 4: Typography (3/4)

- Exactly 2 weights (400/600) are used across the chat surface's own authored components — confirmed by grep: `font-semibold` appears in headings/entry-names/markdown-headings/breakdown totals; `font-medium` appears only in `inline-error-card.tsx:30` and `cost-cap-blocked-card.tsx:20`, both of which are **verbatim reuses of the pre-existing `generation-state-chrome.tsx` fallback-banner idiom** (confirmed: that Studio component already uses `text-sm font-medium text-destructive` at its own line 75) — this is the exact "pre-existing, not introduced net-new" carve-out the UI-SPEC itself documents, not a violation.
- Font-size roles are followed correctly: `text-2xl font-semibold` only on the home empty-state heading (Display, used exactly once as specced); `text-base font-semibold` on toolbar/entry/markdown-heading text (Heading); `text-sm` on message/composer/rail-title text (Body); `text-xs` on meta text (Label size, but see weight gap below).
- **Label-role weight inconsistency:** the Typography contract states Label (12px/600 semibold) covers "badges, cost-meter figures, model capability tags, timestamps." Badges get semibold for free (baked into `packages/ui/src/badge.tsx:8`); capability rows correctly add `font-semibold` explicitly (`model-picker-entry.tsx:109`); the per-turn cost-breakdown rows correctly add it too (`cost-breakdown-popover.tsx:41`, `font-semibold text-foreground`). But:
  - The session cost-meter's own trigger figure — the literal "cost-meter figure" the spec names — is `text-xs text-muted-foreground` with no weight class (`cost-meter.tsx:31`).
  - Rail row timestamps are `text-xs text-muted-foreground` with no weight class (`conversation-row.tsx:92`).
  Both are real, specific misses against an explicitly-named contract item, and the inconsistency (some Label elements semibold, others not) is more damaging than a blanket miss would be, since it makes the weight system read as arbitrary rather than deliberate.

### Pillar 5: Spacing (4/4)

- Rail width matches the spec exactly: `w-[280px]` expanded / `w-0` collapsed (`conversation-rail.tsx:113`), with the required `motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out` (line 112).
- Both documented exceptions correctly implemented: `size-11` (44px) hit areas on Send/Stop (`composer.tsx:91`), rail overflow trigger (`conversation-row.tsx:105`), and jump-to-bottom (`jump-to-bottom-button.tsx:26`); textarea `min-h-[44px] max-h-52` (`composer.tsx:85`) matches the declared 44px/208px non-multiple-of-4 exception precisely.
- Reading-column consistency: `max-w-3xl mx-auto` used identically in both `message-list.tsx:110` and `composer.tsx:76`, exactly as the Layout section requires ("does not affect the rail or toolbar which stay full-bleed" — confirmed: toolbar and rail are not width-constrained).
- The vast majority of `p-*`/`m-*`/`gap-*`/`space-*` usage across all 20+ component files lands cleanly on 4/8/16/24/32/64 (`p-1`, `p-2`, `p-4`, `gap-1`, `gap-2`, `mt-1`, `mb-4`, `mt-6`, `my-2`, `py-24`, `pl-6`, etc.).
- Minor: a handful of half-step Tailwind values (`py-0.5` on inline `<code>` padding in `markdown-renderer.tsx:112`; `gap-0.5`/`p-0.5` on `sibling-nav.tsx:37,43,55`) sit at 2px, below the declared 4px minimum token — trivial, decorative-icon-row spacing, not a rhythm-breaking issue, but technically outside the declared scale's stated exceptions.

### Pillar 6: Experience Design (3/4)

**Confirmed genuinely implemented (not stubbed):**
- Loading: `RailSkeleton` (5 skeleton rows, `aria-busy`, `conversation-rail.tsx:29-41`), `GeneratingIndicator` (`Loader2` + "Generating…", `message-list.tsx:153-168`), `WebLLMLoading` (inline `Progress`, `webllm-loading.tsx`), "Loading conversation…" text fallback (`page.tsx:581-583`).
- Errors: `InlineErrorCard` with `role="alert"` and a Retry that is traced, by inspection, to never reference the composer's draft state (`Composer` owns `value` locally; the retry callback chain in `page.tsx`'s `handleLiveRetry`/`handleRegenerate` never touches it) — this genuinely satisfies D-19/T-22-36, not just by convention.
- Empty states: `ChatHomeEmptyState`, rail's "No conversations yet." (`conversation-rail.tsx:153-155`), popover's "No usage yet in this conversation." (`cost-breakdown-popover.tsx:19-23`).
- Disabled states: Composer Send disabled on empty input or while streaming (`composer.tsx:94`); regenerate disabled while any turn streams (`regenerateDisabled`, threaded through `message-list.tsx`/`turn-action-row.tsx:70-72`).
- Destructive confirmation: hard delete is fully gated behind `AlertDialog` (`delete-conversation-dialog.tsx`) — no bypass path found.
- `aria-live="polite"` state-transition announcer correctly covers **both** loci (server SSE and browser/WebLLM) via the unified `activeStreamState` (`page.tsx:154-169`, `458-460`) — not just the server path.

**Gaps found:**
- **Skeleton pulse animates under reduced motion** — see Top 3 Fix #2 above. This is the one explicit reduced-motion contract item (of three named in the Accessibility section) that isn't honored, because it lives in a shared, unmodified primitive.
- **Silent failure path on WebLLM turn persistence:** `page.tsx:300-302`'s catch block around `recordBrowserTurn.mutateAsync` only does `console.error(...)` — no user-facing indication that the turn wasn't durably saved. The degradation is graceful in the moment (the user still sees their exchange, per the `historyHasCaughtUp` logic never firing so the transient turn stays visible), but a page reload would silently drop that turn with zero warning to the user, and `console.error` from client code doesn't satisfy this project's own "log detailed errors server-side" guardrail. Minor, but a real, findable gap in error-state coverage for a documented persistence path.

---

## Registry Safety

Not applicable — `components.json` does not exist anywhere in the repository (confirmed), matching the UI-SPEC's own statement that no shadcn CLI-managed registry exists in this codebase. The phase's one new npm dependency (`react-markdown`/`remark-gfm`/`rehype-sanitize`/`rehype-highlight`/`@mlc-ai/web-llm`) is explicitly out of scope for this gate per the UI-SPEC's own Registry Safety section (standard supply-chain review applies instead, and was already documented as performed in 22-11's SUMMARY package-legitimacy checkpoint).

---

## Files Audited

**Design contract:**
- `.planning/phases/22-chat-spine-persistence-streaming/22-UI-SPEC.md`
- `.planning/phases/22-chat-spine-persistence-streaming/22-CONTEXT.md`

**Execution summaries:**
- `22-05-SUMMARY.md`, `22-08-SUMMARY.md`, `22-09-SUMMARY.md`, `22-10-SUMMARY.md`, `22-11-SUMMARY.md`

**Implementation (apps/web/src/app/chat/):**
- `page.tsx`
- `_components/chat-home-empty-state.tsx`
- `_components/composer.tsx`
- `_components/conversation-rail.tsx`
- `_components/conversation-row.tsx`
- `_components/cost-breakdown-popover.tsx`
- `_components/cost-cap-blocked-card.tsx`
- `_components/cost-meter.tsx`
- `_components/delete-conversation-dialog.tsx`
- `_components/genui-part-boundary.tsx`
- `_components/inline-error-card.tsx`
- `_components/inline-rename-field.tsx`
- `_components/jump-to-bottom-button.tsx`
- `_components/markdown-renderer.tsx`
- `_components/message-list.tsx`
- `_components/message-turn.tsx`
- `_components/model-picker-entry.tsx`
- `_components/model-picker.tsx`
- `_components/sibling-nav.tsx`
- `_components/turn-action-row.tsx`
- `_components/turn-status-badge.tsx`
- `_components/webllm-loading.tsx`
- `_hooks/use-chat-stream.ts`
- `_hooks/use-webllm-engine.ts`

**Shared primitives inspected for baked-in contract compliance:**
- `packages/ui/src/button.tsx`
- `packages/ui/src/badge.tsx`
- `packages/ui/src/skeleton.tsx`
- `apps/web/src/app/studio/_components/generation-state-chrome.tsx` (source of the "verbatim reuse" pattern claim)
- `apps/email-listener/app/domain/services/chat_model_registry.py` (source of the model picker's `best_for` copy)

**No dev server was available** (checked ports 3000, 5173, 8080) — all findings are derived from static source inspection, not rendered/visual verification. Anything requiring pixel-level layout judgment (actual frosted-glass appearance, real font rendering, genuine reduced-motion behavior in a browser) is flagged `needs_human_review: true` and should be re-verified once a dev server or staging build is reachable.
