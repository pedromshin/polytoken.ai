# Phase 66: Files Vault — v2.1 Self-Cloud Vertical Slice — Context

**Gathered:** 2026-07-17 (night run, Lane D)
**Status:** Ready for planning
**Mode:** Lane-contract-driven — LANE-CONTRACTS.md is the law; this file records how its
ambiguities were resolved against the real codebase, so the plans never re-litigate them.

<domain>
## Phase Boundary

`/files` — a real self-cloud vault over Supabase Storage bucket `user-files`. This is the user's
OneDrive exit, rung v2.1 of the endgame ladder, executed as tonight's vertical slice per
LANE-CONTRACTS.md Lane D: folder tree navigation, upload (picker + drag), download,
delete-with-confirm, and production-grade empty/loading/error states (the SURF-06 bar), on the
LOCKED identity (D-58-01).

**Requirements (minted tonight — orchestrator maps them into the v1.11 ROADMAP registration):**

- **FVLT-01** — Browse: a folder tree over bucket `user-files`, every storage path namespaced
  `{userId}/…` (tenancy accommodation), navigable with breadcrumb + URL deep-linking.
- **FVLT-02** — Ingest: upload via file picker AND drag-anywhere, multiple files, per-file
  progress/error/cancel; explicit folder creation.
- **FVLT-03** — Retrieve/remove: download via short-lived signed URL (attachment disposition,
  always); delete file and folder behind a confirm whose destructive button wears madder
  (irreversible — law 1's calibration).
- **FVLT-04** — Designed states: empty, loading, and error states at the SURF-06 bar — not
  first-draft placeholders — identity-compliant in BOTH themes. The user's parting instruction,
  verbatim: **"make good ui pls."**

**OUT (backlog, enumerated so nobody fakes them tonight):** search, rename, move/copy, share
links, inline preview (see the preview posture below), pagination beyond the 500-entry listing
cap, storage quotas/usage meter, trash/undelete, multi-select bulk actions, mobile-specific
layout beyond responsive rows + touch targets.
</domain>

<decisions>
## Resolved Ambiguities (the contract vs. the real codebase)

### D-66-01 — Folder tree derives from storage `list()`; NO metadata table

The contract's migrations queue exists because journal collisions destroyed work in v1.6. A
metadata table would put Lane D in that queue and couple tonight's merge to the orchestrator's
migration sequencing. Supabase Storage `list(prefix)` already returns one level of the tree —
folders appear as entries with `id: null`, files carry `metadata.size`/`metadata.mimetype`/
`updated_at` — so a lazy per-folder listing IS a real tree with zero schema.

Accepted trade-offs (all backlog, none faked): no global search, no per-file custom metadata,
no server-side sort beyond `list()`'s, folders are implicit (a folder exists iff it contains an
object — "New folder" writes a zero-byte `.emptyFolderPlaceholder`, the Supabase dashboard's own
convention, filtered from listings). `SCHEMA-REQUEST.md` therefore contains ONLY the bucket
creation config — no tables.

### D-66-02 — Router location: `packages/api-client/src/router/files/` (new files only)

The contract grants `apps/web/src/server/api/routers/files*` — a path that DOES NOT EXIST in
this codebase (the contract assumed a create-t3-app layout). Every real router lives in
`packages/api-client/src/router/{chat,emails,…}/`, and `root.ts` is the only wiring point. The
contract's intent — "your API is new files; the orchestrator does the one-line wiring" — maps to
exactly one honest location: `packages/api-client/src/router/files/` as NEW FILES ONLY, with the
`files: filesRouter` line in `root.ts` requested via SUMMARY, never edited by this lane.

Consequence the orchestrator must apply at merge (declared in SUMMARY `deps:`):
`@supabase/supabase-js` added to `packages/api-client/package.json` dependencies. It is ALREADY
in the root lockfile (apps/web dependency, hoisted) — no new third-party code enters the tree,
so in-worktree `tsc` resolves it today; the entry is hygiene. Note: `trpc.ts`'s "dependency-free
of Supabase" comment governs the CONTEXT SHAPE (T-43-P3-04: no `next/headers`, no
`@supabase/ssr`); an isomorphic storage client inside one router directory does not violate its
letter, and the files router documents this in its header.

### D-66-03 — The UI reaches the router through a lane-scoped tRPC client (temporary seam)

Until the orchestrator wires `files: filesRouter` into `root.ts`, `api.files.*` on the global
client cannot typecheck — and this lane's bar is green `tsc` IN-WORKTREE. So the surface ships
`apps/web/src/app/files/_lib/vault-api.tsx`: `createTRPCReact<VaultAppRouter>()` where
`VaultAppRouter` is a TYPE-ONLY relative import of the router package's own
`createTRPCRouter({ files: filesRouter })` composition (erased at compile — zero runtime
coupling), pointed at the SAME `/api/trpc` endpoint with the SAME superjson link config. It
works at runtime the moment `root.ts` gains the wiring, because both sides address procedure
path `files.*`. Recorded cleanup (post-merge, orchestrator or a later phase): migrate the
surface to the global `~/trpc/react` `api` object and delete the seam — a find-replace.

### D-66-04 — No inline preview tonight; the allowlist posture is decided NOW

The slice definition does not require preview, and depth-first says spend the budget on the
states + interactions. But the security posture is decided tonight so no future phase improvises
it: every download URL is minted with `download: <filename>` (attachment disposition, ALL
content types); when preview arrives it may inline ONLY an allowlist (`image/png`, `image/jpeg`,
`image/gif`, `image/webp`, `application/pdf`) — NEVER `text/html`, NEVER `image/svg+xml` (script
carriers). Declared `contentType` is stored but never trusted for rendering decisions.

### D-66-05 — Identity application (the taste calls, made once, here)

- **File and folder NAMES are METADATA → sans.** Locked by the lane contract ("file names are
  METADATA/chrome, sans"). This surface displays NO evidence tonight — nothing on it came out of
  the user's mail — so `font-serif`, `data-evidence`, `pmark`, and `chip` must appear NOWHERE
  under `files/`. The surface's own law gate asserts their absence, so serif drift is a red test
  the day someone adds a text-file preview without re-deciding this.
- **Madder calibration:** the delete CONFIRM button inside the AlertDialog wears
  `variant="destructive"` — genuinely irreversible, law 1's one correct madder. The menu item /
  row action that OPENS the dialog stays ink (it is cancellable). Upload failures, load failures,
  conflicts: NEVER madder — the swept treatment (`border-rule` + `text-ink`, glyph carries the
  role, `role="alert"`).
- **File-kind iconography is geometry, never hue** (law 3's spirit): a closed literal lookup from
  extension-derived kind → lucide glyph (`Folder`/`FileText`/`FileImage`/`FileArchive`/
  `FileAudio`/`FileVideo`/`File` default), all `text-faded`. No per-kind colour. `tshape-*` is
  NOT used — those are entity-type shapes (supplier/person/…), not file kinds.
- **Sizes, dates, counts: `tabular`.** Dates absolute ("12 Jul 2026") — registry rhythm, and no
  relative-time hydration ambiguity.
- **No Radix ScrollArea on this surface.** The page scrolls; the listing is a block list. This
  sidesteps the `display:table` viewport trap (D-61-06) entirely instead of managing it.
- **Selection/focus: ink `outline` + `outline-solid`, never `ring`** (white-halo-in-dark trap);
  `pointer-coarse:touch-target` on every row action and dialog control (works since 61-08).
- **Both themes by construction:** semantic tokens/classes only (`bg-bright`, `border-rule`,
  `text-ink`, density steps). Zero new `@utility` declarations — if a needed class does not
  exist, use an existing step, do not mint one tonight. The global `palette-ban` gate already
  scans `files/` for raw palette classes.

### D-66-06 — The `role-hue-ban` ratchet append is a REQUEST, not this lane's edit

Lane A owns the ratchet (`apps/web/src/app/__tests__/role-hue-ban.test.ts` SCOPED_DIRS). This
lane ships its own scoped law gate at `apps/web/src/app/files/__tests__/files-law.test.ts`
(mirroring role-hue-ban's line-reading mechanics) so the surface is born clean and PROVEN clean,
and the SUMMARY requests the orchestrator append `files` to SCOPED_DIRS post-merge — the append
is the LAST step of a sweep, and the sweep is this phase.

### D-66-07 — Tenancy: `{userId}/` prefix is derived server-side, by construction

Every storage key is built by ONE function, `vaultKey(userId, segments)`, where `userId` comes
exclusively from `ctx.user.id` (protectedProcedure) and `segments` cross a zod schema that
rejects separators, `.`/`..`, control characters, and the reserved placeholder name. The server
NEVER accepts a full storage key from the client — only validated relative segments. This is
path traversal made impossible by construction, and Plan 01's negative proofs demonstrate the
tests catch its removal.
</decisions>

<amendments>
## Amendments — the taste layer landed AFTER this context was written (2026-07-17, planner 2)

`docs/design/taste-references.md` was authored tonight, after the decisions above were recorded,
and it is binding (it carries the user's verbatim directive: *"minimize clicks"*, *"make good ui
pls"*, *"you typically make good generic uis … lets make it a little better"*). It exists ONLY in
the main checkout — this worktree branched before it — so read it there:
`C:\Users\pc\Desktop\nauta.services.email-listener\docs\design\taste-references.md`. Its §3 has a
`/files vault` section written specifically for this lane, and two of its rulings contradict the
decisions above. They win, for the reasons recorded here. **D-66-01 through D-66-04 and D-66-06
stand unchanged** — they were right, and D-66-05 needs no edit, only the additions below.

### D-66-08 — NO tree WIDGET. Navigation is breadcrumb + folder-rows drill-down.

taste-references §3 rules, verbatim: *"Do NOT: impose a folder-tree/Miller-columns sidebar unless
the vault has real folder depth"*, and its component table repeats it: `@kibo-ui/tree` is to be
installed *"ONLY where real hierarchy exists … Do not bolt onto the flat /files vault."* Its
anti-generic tell #5 is the *everything-at-once dashboard silhouette* — "tree + toolbar +
breadcrumb + list + preview + metadata rail all permanently visible. Two panes carry the work;
the rest is contextual."

Against that: LANE-CONTRACTS says "folder tree", and FVLT-01 says "a folder tree … navigable with
breadcrumb + URL deep-linking". Both are satisfied without a tree widget: **the vault HAS a folder
tree — the user authors it (FVLT-02 mints folder creation; this is a OneDrive exit, not a capture
pile) — and it is navigated by drilling into folder rows, with the breadcrumb as the way back and
the URL (`?path=`) as its address.** FVLT-01's own words name the breadcrumb as the navigation.

The deciding argument is not taste, it is earnings: **move/copy is OUT tonight** (see `<domain>`).
A tree pane's unique value over drill-down is drag-a-file-into-a-folder and cross-branch jumping.
Without move, a tree earns only "jump to a sibling folder" — which breadcrumb + drill-down already
does, and which ⌘K will do better when the palette lands (taste checklist item 4). It would cost
roughly half a plan (lazy async children, `aria-tree` roving tabindex, expansion state) and buy a
third permanent pane, i.e. tell #5. **Cut it.** Chanel's rule: this is the accessory we remove.

Consequence: ONE pane carries the work. There is no details/preview rail either — D-66-04 ships no
content preview, so a metadata rail would restate the row it was opened from. The row IS the
detail. Selection still exists (↑/↓ + Enter) because it is what makes the surface keyboard-operable
— it just does not drive a second pane tonight. When preview arrives under D-66-04's allowlist, the
select→preview-in-place grammar (taste §3 items 1–3, Space Quick Look) is the shape it must take,
and the selection state built tonight is already its seam.

**If the orchestrator disagrees, this is the one decision to veto — it is legible and reversible.**

### D-66-09 — ZERO component-pack installs tonight. Not a taste call — a lane-boundary fact.

taste-references §4 picks `@shadcn/empty` and `@kibo-ui/tree` for this surface. Both install into
`packages/ui/src/` — **which Lane D does not own** (owned paths are `apps/web/src/app/files/**`,
`.../routers/files*`, `packages/storage/**`). `package.json`/lockfile changes are explicitly
orchestrator-reserved. So the packs are not available to this lane tonight at any price, and
copying their payloads into `files/_components/` to dodge the boundary would be laundering.

It costs nothing real. `@kibo-ui/tree` is cut anyway (D-66-08). `@shadcn/empty` is structural slots
with no baked colour — our empty state is one line of copy, one button, and the pane's own drop
affordance (~20 lines hand-rolled, per §3's *"the whole pane is the drop zone"*); the pack would be
re-skinned down to nothing. Both stay on the shopping list for whoever owns `packages/ui` next.

**The dividend: zero new packages tonight ⇒ the Package Legitimacy Gate is satisfied trivially and
`T-66-SC` (supply-chain tampering) reduces to `accept` with a real rationale, not a checkpoint.**

Same boundary, one more consequence — **`packages/ui/src/dropzone.tsx` is NOT usable as-is and NOT
ours to fix.** It renders a *card-shaped* drop area (fights "the entire content pane is the drop
target") and its drag-active state is `outline-none ring-1 ring-ring` — a stock accent (law 1
violation) and the `outline-none`/ring trap in one line. taste §4 says "verify its drag-active
state is ink, not a stock accent"; the verification FAILS, and the fix is Lane A's. So the vault
hand-rolls pane-level drag handlers (~30 lines, zero deps, and the only shape that CAN be
"drag anywhere"), and the SUMMARY carries the dropzone finding as a request. `react-dropzone` is
therefore never imported by `files/` — no dep entry needed beyond D-66-02's.

### D-66-10 — Click economy is a TESTABLE criterion on this surface, not an aspiration

The user's directive is the interaction half of law 1 (taste §1: *"colour is earned — and so is
every click"*). This surface's budget, each item gated by a real test in Plan 04:

| Action | Cost | Mechanism |
|---|---|---|
| Upload | **0 clicks** | drag anywhere onto the pane — the whole surface is the target |
| Upload (fallback) | **1 click** | "Upload files" → native picker (no intermediate modal, no card) |
| Enter a folder | 1 click / `Enter` | folder rows drill down; `?path=` is the address |
| Scan the vault | **0 clicks** | `↑`/`↓` move selection |
| Download | 1 click / `Enter` | row action is focus/hover-revealed; `Enter` fires it on the selection |
| New folder | 1 click + type + `Enter` | an **inline row in edit state** — never a modal (taste item 10) |
| Delete | 1 click / `Delete` → confirm | the ONE modal on this surface, and it is correct (below) |

**Undo-vs-confirm, settled:** taste item 2 says reversible actions never confirm — they fire with
an undo toast; confirm modals and `--bad` share exactly one scope, the irreversible. There is no
trash in this vault (`trash/undelete` is OUT), so **delete IS irreversible: the confirm modal is
correct and the madder fill on its confirm button is correct** (D-66-05 already said so; this is
the interaction-side reason). Upload is additive, folder creation is additive — neither confirms.
That leaves exactly one modal and exactly one madder control on the whole surface. That is the
story the surface tells about itself, and it is checkable in a screenshot.

### D-66-11 — The signature: the sheet accepts the file. Boldness spent once, here.

`frontend-design`'s rule is to spend boldness in ONE place and keep everything around it quiet, and
D-58-01 already forbids the usual places to spend it (no hue on chrome, no shadows, no accent).
So the vault's one memorable moment is the **drag-accept**: dragging a file anywhere over the vault
makes the sheet itself rise to meet it — the ground steps `bg-leaf` → `bg-bright` and the pane's
rule thickens to `border-ink` (elevation via the ground ladder, which is this identity's ONLY
elevation device — never a shadow, never a dashed blue box, never a new hue). The registry rhythm
of the rows below stays perfectly still. *The paper accepts the document* — a filing cabinet, not a
web uploader, which is exactly what a self-cloud vault is.

Everything else on this surface is deliberately quiet: no permanent toolbar, row actions
focus/hover-revealed, no icon-button row without a label or tooltip (tell #4), no centered card
(tell #1), no colour-coded file types (tell #2 / law 3 — kind is glyph geometry in `text-faded`).

**Copy** (frontend-design: copy is design material; an empty screen is an invitation; errors do not
apologize and are never vague). Fixed strings, active voice, sentence case, one job each:
- Empty vault: **"Drop a file anywhere to start your vault"** + button **"Upload files"**. Nothing
  else prominent. The pane IS the dropzone — the empty state teaches the gesture it will use forever.
- Empty folder: **"This folder is empty. Drop a file anywhere to fill it."**
- Load failure: **"Couldn't load this folder."** + **"Try again"**. Never madder. `role="alert"`.
- Upload failure (per file): **"Upload failed — {reason}."** + **"Retry"**. Never madder.
- Delete confirm: title **"Delete {name}?"**, body **"This can't be undone."**, buttons **"Cancel"**
  / **"Delete"** (`variant="destructive"` — the one madder control).
- The action keeps its name through the flow: "Upload files" → "Uploading…" → "Uploaded".
</amendments>

<code_context>
## Existing Code Insights (verified against this worktree)

- **tRPC:** routers in `packages/api-client/src/router/*`; `trpc.ts` exports `createTRPCRouter`,
  `protectedProcedure` (UNAUTHORIZED on null user, narrows `ctx.user`), context
  `{ headers, db, user }`. `root.ts` wiring + `index.ts`/`package.json` exports map are
  orchestrator-reserved. Caller-based tenancy tests exist as the idiom to mirror
  (`chat-user-scoping.test.ts`: `appRouter.createCaller({ db: {} as never, headers, user })`).
- **Storage precedent:** `apps/web/src/app/api/attachments/[id]/route.ts` — service-role client
  minted server-side from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (missing-secret guard,
  T-05-09), ownership asserted BEFORE any signed URL, only `{ url }` reaches the browser,
  fail-closed 404 with no existence oracle. The vault adapter follows this exactly.
- **Browser Supabase client:** `~/lib/supabase/client.ts` (`createBrowserClient`, public env
  only) — available for upload if needed, though the upload pipeline uses raw XHR against the
  minted signed upload URL for real progress events.
- **UI kit:** `@polytoken/ui` has `dropzone` (SUPERSEDED — see D-66-09), `alert-dialog` (+ the
  `reject-dialog.tsx` madder-confirm idiom), `breadcrumb`, `skeleton`, `dropdown-menu`,
  `progress`, `sonner` (Toaster already mounted in root layout), `button` (`variant="destructive"`
  → `bg-destructive` → `--bad`). There is NO `empty` and NO `tree` component, and this lane
  cannot add one (D-66-09).
- **Page shell idiom:** `knowledge/page.tsx` — server component for metadata + frame, one
  `"use client"` surface component below it.
- **No `formatBytes` exists in the app** — the vault vocabulary supplies one, tested.
- **Identity classes are live and confirmed in the swept surfaces** (`chat/_components/`):
  `bg-leaf`, `bg-bright`, `bg-shade`, `border-rule`, `text-ink`, `text-faded`, `text-pencil`,
  `tabular`, `touch-target` are all real. `knowledge/page.tsx`'s `text-foreground`/`border-border`
  is UNSWEPT legacy — do not copy its classes, only its shell shape.
- **Env:** unit tests + `npx tsc --noEmit` green in-worktree is the bar. NO dev server (port
  3000 is main's), NO playwright, npm workspaces NOT pnpm. The shared local Supabase is main's:
  all tests run against fakes; the live bucket is created in the orchestrator's integration step
  (SCHEMA-REQUEST.md carries the config).
</code_context>

<deferred>
## Deferred / Orchestrator Requests (consolidated — each plan's SUMMARY restates its own)

1. `root.ts`: add `files: filesRouter` (import from `./router/files`).
2. `packages/api-client/package.json`: add `@supabase/supabase-js` dependency (already in root
   lockfile via apps/web — entry only).
3. Nav/sidebar: register `/files` ("Files").
4. `role-hue-ban.test.ts` SCOPED_DIRS: append `files` (surface born clean; local gate proves it).
5. Screenshot harness + geometry gate: add `/files` (both themes × 390/1440); READ the PNGs.
6. Bucket `user-files` creation per `SCHEMA-REQUEST.md`.
7. Post-merge cleanup (non-blocking): migrate the surface from the `vault-api` seam to the
   global `api` object once `root.ts` is wired.
8. **NEW (D-66-09):** `packages/ui/src/dropzone.tsx` drag-active state is `ring-1 ring-ring` —
   a stock accent (law 1) plus the `outline-none`/ring trap. Lane A owns the re-skin; every
   surface that uses `Dropzone` is currently rendering a non-earned hue on drag.
9. **NEW (D-66-09):** shopping list deferred, not rejected — `@shadcn/empty` and `@kibo-ui/tree`
   (the tree only if a surface with real cross-branch navigation earns it).
</deferred>
