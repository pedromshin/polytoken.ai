# Phase 27: Adopted External Design Picks - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommended answers auto-accepted per yolo config; each marked [auto])

<domain>
## Phase Boundary

The five researched external resources' narrowly-scoped, zero/near-zero-footprint takeaways land
in the app and its docs: impeccable.style's product-register rules + 13-item absolute-bans
checklist as a standing prose appendix (ADOPT-01), Magic UI's `file-tree` ported (ADOPT-02), a
hand-ported teal-only `<GeneratingRing>` CSS primitive (ADOPT-03), the 3 `ux-designer-skill`
reference files copied into a slim project reference (ADOPT-04), and 3–4 `transitions.dev` CSS
snippets retokenized to the app's custom properties (ADOPT-05).

**Locked source of truth:** `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` → "External resource
verdicts" table. The verdicts are FINAL (adopt-now / adopt-now-narrow); do not re-litigate. The
rejected items (border-beam, animated-list, terminal, dock, highlighter, Tailark, the 4 overlapping
agent skills) stay rejected.

**Hard constraints:** zero new npm dependencies (file-tree must compile against already-installed
`@radix-ui/react-accordion` + `lucide-react` only); teal primary only; 2-weight typography; 4-point
grid; 60/30/10; Tailwind v3.4.4; `spec-renderer.tsx`/`GenuiPartBoundary`/`InteractiveWidgetBoundary`
untouched; no token VALUE changes (Phase 28 owns tokens).

</domain>

<decisions>
## Implementation Decisions

### Where standing design docs live (ADOPT-01, ADOPT-04)
- [auto] Create `docs/design/` (repo has no docs/ dir yet — this starts it).
- [auto] ADOPT-01 → `docs/design/product-register-and-bans.md`: PARAPHRASED (not verbatim-copied)
  product-register rules + the 13-item absolute-bans checklist, with source attribution
  (impeccable.style, Apache-2.0). Add a one-line pointer at the end of the phase UI-SPEC template
  usage — future `/gsd:ui-phase` researchers and the 6-pillar `gsd-ui-auditor` read this file
  (reference it from 27-UI-SPEC.md onward so the convention is discoverable).
- [auto] ADOPT-04 → `docs/design/references/` with the 3 files copied (license permitting, with
  attribution headers): canvas-navigation, canvas-objects-performance, ai-ux-patterns from
  `ux-designer-skill`. Slim = copy only those 3, no skill machinery.

### ADOPT-02 file-tree — consumer gap resolved (scout finding 2026-07-06)
- [auto] SCOUT FINDING: the research doc's assumed consumer ("code-island's multi-file output")
  does NOT exist — `code-island-frame.tsx` has no file list; islands emit a single code string.
- [auto] Honest mount point: port `FileTree` as `apps/web/src/components/file-tree.tsx` (hand-port
  of Magic UI's component, MIT, attribution header, zero new deps) and mount it in the Code-Island
  tab (`code-sandbox-island.tsx`) as the demo fixture/preset browser — the fixtures (curveball
  soundscape mixer, broken→heals, unrepairable→fallback) ARE a real file-shaped structure today.
  When multi-file islands arrive (v1.5+), the primitive is already in place.
- [auto] If the executor finds the fixture-picker mount genuinely worse UX than the current
  control, mount it instead as a collapsible "island source" tree (code + srcdoc parts) in the
  Code-Island tab — either way the component ships MOUNTED and VISIBLE, not as dead code.

### ADOPT-03 GeneratingRing
- [auto] `apps/web/src/components/generating-ring.tsx` + additive keyframes in `globals.css`
  (@layer, token-based): hand-port the CSS TECHNIQUE from Magic UI shine-border +
  animated-shiny-text (pure `background-position` keyframes, zero JS). Teal-only (uses
  `--primary`), `motion-safe:`-gated, respects `prefers-reduced-motion`.
- [auto] Consumers: (a) Studio — `generation-state-chrome.tsx`'s in_progress state (currently
  Loader2 spinner + "Generating…") gains the ring around the pane; keep the honest "Generating…"
  label (D-02). (b) Chat — applied by the PARENT wrapper of the streaming genui part (message-turn
  level or the part wrapper AROUND `GenuiPartBoundary`) — `GenuiPartBoundary` itself is LOCKED and
  must not be edited. (c) Studio history tab in-flight rows if trivially reachable.

### ADOPT-05 transitions.dev snippets
- [auto] Hand-copy 3–4 snippets (modal, panel-reveal, dropdown) RETOKENIZED to the app's CSS
  custom properties, as additive `@layer` utilities in `globals.css` (or a dedicated
  `transitions.css` imported by globals if size warrants), each with a source-attribution comment.
- [auto] Wire at least ONE real consumer per snippet where a matching Radix surface exists
  (delete-conversation dialog = modal snippet; conversation rail collapse or canvas
  EdgeCreationPicker = panel-reveal; model-picker dropdown = dropdown snippet) so the snippets are
  observable, not dead CSS. Do not restyle beyond the transition itself.
- [auto] Document the available utilities at the bottom of `docs/design/product-register-and-bans.md`
  (one section, few lines each).

### External fetching + licensing (execution mechanics)
- [auto] Executors fetch sources at execution time via `curl`/`gh` from the canonical repos/sites
  (impeccable.style skill repo, `magicuidesign/magicui` for file-tree + shine-border +
  animated-shiny-text source, the `ux-designer-skill` repo, transitions.dev). Re-verify license
  (Apache-2.0 / MIT / published-free) before copying, per this repo's package-legitimacy
  checkpoint precedent (23-05 zustand). Every copied/ported/paraphrased file carries an
  attribution header (source URL + license + date).
- [auto] If a source is unreachable or its license turns out incompatible at fetch time: SKIP that
  item, record the deviation in the SUMMARY, do NOT substitute a different library.

### Claude's Discretion
- Exact keyframe values/durations, exact snippet selection among transitions.dev's catalog,
  FileTree prop surface trimming (drop Magic UI props with no consumer), and test granularity.

</decisions>

<code_context>
## Existing Code Insights

### Scout findings (2026-07-06)
- `code-island-frame.tsx`: no multi-file/file-list structure exists (ADOPT-02 consumer gap — see
  decision above). `code-sandbox-island.tsx` is the preset/fixture demo surface.
- `generation-state-chrome.tsx:88-96`: in_progress = Loader2 spin + "Generating…" (D-02 honesty
  label — KEEP the label, add the ring).
- `genui-part-boundary.tsx`: has skeleton/streaming paths but the file is LOCKED (Phase 24 + v1.4
  roadmap non-interference) — chat-side ring wraps from the parent.
- No `docs/` directory exists yet.
- `tailwindcss-animate` is installed/wired; Phase 26 added `@layer` React Flow chrome + a
  `.scrollbar-token` utility to `globals.css` — follow that additive pattern (and do NOT touch
  token values; the 26-VERIFICATION grep gate `:root`/`.dark` count 55 must stay 55).

### Reusable Assets
- Phase 26's `json-pane.tsx`/`empty-state.tsx` show the shared-component + colocated-test
  convention (`createRoot`+`act` mounting, vitest).
- Icon-only buttons use `size-11` (44px) per Phase 26 convention; `lucide-react` only.
- `@radix-ui/react-accordion` is already a dependency (file-tree needs it).

### Integration Points
- `apps/web/src/components/` — shared primitives home (file-tree, generating-ring)
- `apps/web/src/app/studio/_components/code-sandbox-island.tsx` — file-tree mount
- `apps/web/src/app/studio/_components/generation-state-chrome.tsx` — ring (studio)
- `apps/web/src/app/chat/_components/message-turn.tsx` (or message-list part wrapper) — ring (chat)
- `apps/web/src/app/globals.css` — additive keyframes/utilities only
- `docs/design/` — new standing design docs

</code_context>

<specifics>
## Specific Ideas

- Research doc verdict language is binding: "Take: `file-tree`", "hand-port the CSS *technique*
  only", "copy exactly 3 reference files", "Reject as a group".
- The ring replaces visual boredom, not semantics: never relabel "Generating…" to "Streaming".

</specifics>

<deferred>
## Deferred Ideas

- impeccable `checks.mjs` vendoring into the genui repair loop — research doc: "deferred, not
  forgotten"; do when that loop is touched for other reasons.
- styles.refero.design numeric backing — cite during Phase 28's shadow/radius work.
- Multi-file code-island output (real file-tree consumer) — v1.5+ orchestration/design-engine work.

</deferred>
