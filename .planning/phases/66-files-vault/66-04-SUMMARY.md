---
phase: 66-files-vault
plan: 04
subsystem: vault-write
tags: [ui, upload, identity, law-gate, click-economy]
requires: ["66-01", "66-02", "66-03"]
provides:
  - "/files usable end-to-end — drag/picker upload, progress, cancel, inline folder create, delete"
  - "useVaultDrop / useVaultUpload"
  - "files-law.test.ts — the scoped law gate"
affects: []
tech-stack:
  added: []
  patterns: ["pane-level drag counter", "XHR signed-upload with real progress", "scoped law gate"]
key-files:
  created:
    - apps/web/src/app/files/_lib/use-vault-drop.ts
    - apps/web/src/app/files/_lib/use-vault-upload.ts
    - apps/web/src/app/files/_components/vault-drop-layer.tsx
    - apps/web/src/app/files/_components/upload-tray.tsx
    - apps/web/src/app/files/_components/new-folder-row.tsx
    - apps/web/src/app/files/_components/delete-dialog.tsx
    - apps/web/src/app/files/_components/__tests__/vault-write.test.tsx
    - apps/web/src/app/files/__tests__/files-law.test.ts
  modified:
    - apps/web/src/app/files/_components/vault-surface.tsx
    - apps/web/src/app/files/_components/vault-listing.tsx
decisions: [D-66-09, D-66-10, D-66-11, D-66-15]
metrics:
  tasks: 3
  tests-added: 33
  phase-tests: 149
  completed: 2026-07-17
---

# Phase 66 Plan 04: The Vault You Can Write — PHASE CLOSING SUMMARY

Drop a file anywhere and the sheet rises to accept it. This is the phase's hand-over.

Commits: `af0af4f`. **Phase totals: 149 tests** (68 vault core + 26 router + 55 surface), full suites
green — **web 1073 passed / 2 skipped (85 files)**, **api-client 536 passed (40 files)**, both
`tsc --noEmit` clean.

---

## 🔴 READ THIS FIRST: NOBODY HAS SEEN ANY OF THIS

No dev server (3000 is main's), no playwright, no screenshots — LANE-CONTRACTS protocol 3. **jsdom
does no layout and loads no CSS.** 149 green tests prove callbacks fire and class strings are
present. They cannot prove this surface looks like anything at all.

**Eleven bugs shipped through green suites this milestone. Every one was found by looking.**

### The three things a human must LOOK at, post-merge

1. **The drag-accept — does the sheet RISE, or does it strobe/flash?**
   Drag a file across the pane, slowly, over the rows. The ground should step `leaf`→`bright` once
   and hold, with the rule thickening to ink and the rows perfectly still. The counter logic is
   unit-tested; **what a state change looks like at 150ms is not.** If it flickers as the pointer
   crosses rows, the counter is leaking somewhere jsdom cannot see.

2. **The empty state — one teaching action, or a lonely card in dead space (tell #1)?**
   `/files` with an empty vault. It should read as a sheet inviting a drop, not as a shadowed box
   marooned in whitespace. `py-20` is a number I chose without ever seeing it.

3. **The dark theme — is `bright` readable against `shelf`, and is the delete button's madder the
   ONLY colour on screen?**
   Toggle to dark, open the delete dialog. Madder should be the single hue in the entire viewport.
   The tier-on-wash pairs have ~0.09 of AA headroom in light (D-58-01) — this surface adds no new
   pairs, but nobody has measured it rendered.

**This plan claims its tests pass. It does not claim the surface looks right.**

---

## USABLE end-to-end — precisely, with the caveats

**Once the orchestrator does two things** (wire `root.ts`, create the bucket), a signed-in user can:

| Capability | Status |
|---|---|
| Browse a real folder listing over `user-files` | ✅ |
| Walk into folders; breadcrumb back; `?path=` deep-links and Back walks out | ✅ |
| Scan the whole vault with arrows alone; `Enter` acts; `Delete` asks | ✅ |
| Upload by dropping anywhere on the pane — **0 clicks** | ✅ |
| Upload from the picker — **1 click**, no intermediate modal | ✅ |
| Per-file real progress, cancel mid-flight, per-file failure with the reason named | ✅ |
| Retry a failed upload from the tray | ⚠️ **NO** — dismiss only; re-drop the file (see deviation 4) |
| Create a folder inline — **1 click + type + Enter**, no modal | ✅ |
| Download via 60s signed URL, attachment disposition, all types | ✅ |
| Delete a file or a folder (recursive) behind one confirm | ✅ |
| Empty / loading / error states at the SURF-06 bar, both themes by construction | ✅ |

### What does NOT work until the orchestrator acts — no over-claiming

- **Until `root.ts` gains `files: filesRouter`: every procedure call 404s.** The page renders; the
  listing query fails; the user sees "Couldn't load this folder." **Nothing works.**
- **Until the bucket `user-files` exists: every call 500s** with "Something went wrong reaching your
  files."
- **Until `/files` is registered in the nav: the route is reachable only by typing the URL.**

---

## The click budget — asserted, and unchanged

Every row of D-66-10's table is a real test. **No design decision in this phase cost a click**, so
no assertion needed changing.

| Action | Budget | Gated by |
|---|---|---|
| Upload | **0 clicks** — drag anywhere onto the pane | `vault-write` — drop fired on the PANE, not a button |
| Upload (fallback) | **1 click** — picker | `vault-write` — asserts **no dialog and no menu** opened in between |
| Enter a folder | 1 click / `Enter` | `vault-listing` — asserts **no `role="menu"`** in between |
| Scan the vault | **0 clicks** — `↑`/`↓` | `vault-listing` — roving tabindex, clamped |
| Download | 1 click / `Enter` | `vault-listing` |
| New folder | **1 click + type + `Enter`** | `vault-write` — input has DOM focus, **`dialog` AND `alertdialog` both null** |
| Delete | 1 click / `Delete` → confirm | `vault-write` — **exactly ONE** `alertdialog` |

**One modal and one madder control on the whole surface**, and `files-law.test.ts` counts the madder
to exactly `delete-dialog.tsx`.

## Negative proofs — all five red, all five restored

| # | Sabotage | Result |
|---|---|---|
| 1 | `text-destructive` on the upload-tray error row | **RED — BOTH gates, by name:** law gate's madder count **and** `vault-write`'s not-madder assertion |
| 2 | `font-serif` on `vault-row`'s name | **RED** — law gate |
| 3 | `dangerouslySetInnerHTML` in a component | **RED** — law gate |
| 4 | Drag counter → boolean | **RED** — the strobe test |
| 5 | "New folder" wrapped in a Dialog | **RED** — the no-modal assertion |

## D-66-15 (new) — the law gate had two bugs, and the gate found them

Both were caught only because the gate was run and read rather than assumed green. Recorded because
each is a *general* trap, not a typo:

1. **The madder check matched NOTHING.** It looked for `variant="destructive"` — the JSX attribute
   form — while `delete-dialog.tsx` sat right there using `buttonVariants({ variant: "destructive" })`,
   the object form. **A gate looking for one spelling of a rule reports safety on every other
   spelling**: `bg-destructive`, `text-destructive`, and `variant: "destructive"` all paint madder
   and all would have passed. Now matches the TOKEN in any form.
2. **The comment stripper handled `/*` but not `{/*`.** The gate's first run reported a
   `dangerouslySetInnerHTML` violation in `vault-row.tsx` — which was **its own JSX comment
   explaining that names are never rendered that way**. Precisely the self-invalidating outcome the
   gate's own header warns about, arriving through a form the header did not anticipate. `.tsx` is
   most of this surface and `{/* … */}` is how it carries inline prose. Both forms are now pinned by
   the stripper's self-test, so the regression cannot return quietly.

**The pattern worth carrying to the other lanes: a gate that has never been seen to fail is not a
gate.** Three separate checks in this phase reported safety while inspecting the wrong thing
(these two, plus Plan 03's `/shadow-/` regex that missed the kit's bare `shadow`).

## The transport — verified against the installed package, not from memory

Plan 04 §E required confirming the signed-upload contract before writing the hook. Read from
`node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:275` + `lib/common/fetch.ts:239`:

```
uploadToSignedUrl  ->  PUT {signedUrl}          ← token ALREADY in the query string
                       body: FormData(cacheControl="3600", "" -> File)
                       headers: x-upsert
```

**Path (a) taken.** The same request is issued over XHR for exactly one reason: `upload.onprogress`
and `abort()`, which FVLT-02 requires and the SDK does not expose. **The indeterminate-progress
fallback was not needed** — progress is real bytes, not a fake percentage. No Authorization header:
the signed URL carries its own token, which is what makes a direct browser→storage PUT possible
without shipping a credential.

---

## ⚠ ORCHESTRATOR HAND-OVER

### deps
- `packages/api-client/package.json` → add **`@supabase/supabase-js`**. **Entry only** — already in
  the root lockfile via `apps/web` (verified hoisted). No new third-party code enters the tree.
  **Zero new packages in this whole phase** ⇒ the Package Legitimacy Gate has nothing to audit and
  `T-66-SC` reduces to `accept` with a real rationale.

### Wiring requests
1. **`root.ts`:** add `files: filesRouter` (import from `./router/files`). One line. **Blocking —
   nothing works without it.**
2. **Nav/sidebar:** register `/files` → **"Files"**.
3. **`role-hue-ban.test.ts` `SCOPED_DIRS` += `files`** (D-66-06). The surface is born clean and
   `files-law.test.ts` **proves** it — which is what earns the append. That file is Lane A's; this
   lane did not touch it. *The append is the last step of a sweep, and the sweep is this phase.*
4. **Screenshot + geometry harness:** add `/files`, **both themes × 390 and 1440**, and **READ the
   PNGs** — see the three items above.

### Schema request
- **Bucket `user-files`** per `SCHEMA-REQUEST.md`. **ZERO TABLES** — do not queue a migration for
  this lane. The file carries the bucket config, the RLS tripwire, and a 9-step live verification
  (including the cross-tenant check) that this lane structurally could not run.

### Post-merge cleanup (non-blocking)
- Delete `apps/web/src/app/files/_lib/vault-api.tsx`; find-replace `vaultApi` → `api` from
  `~/trpc/react`; drop `<VaultApiProvider>` from `files/page.tsx` (D-66-03). Its header carries this
  contract.

### 🔧 FINDINGS FOR LANE A — not ours to fix

1. **`packages/ui/src/dropzone.tsx`'s drag-active state is `outline-none ring-1 ring-ring`** — a
   stock accent (law 1 violation) **and** the `outline-none`/ring trap in one line. **Live on every
   surface using `Dropzone` today.** This is exactly why the vault hand-rolls its own drop handlers
   (D-66-09); it is not imported, and it was not touched.
2. **`packages/ui/src/button.tsx`'s base carries `focus-visible:outline-none focus-visible:ring-1
   focus-visible:ring-ring` and the default variant ships a bare `shadow`.** Every consumer must
   remember `shadow-none` (this surface does; `composer.tsx` does). The ring is *acceptable* —
   `--ring: var(--ink)` is hueless and the base sets no `ring-offset`, so the white-halo trap is
   absent — but it means "no ring on swept surfaces" is not true of the kit itself.
3. **`npm run test -w <pkg>` / `npm run typecheck -w <pkg>` MUTATE `package-lock.json`** (npm prunes
   `extraneous` entries — 590 lines on the first run here). The plans' verify commands all use that
   form, and lockfile changes are orchestrator-reserved. **Check the other lanes' worktrees for a
   dirty lockfile at merge.** This lane reverted it and used `npx vitest run --root <pkg>` /
   `npx tsc --noEmit -p <pkg>` throughout.
4. **`@testing-library/react` is not installed and is not resolvable**, yet Plans 03/04 (and likely
   B/C/E's) call it "the app's existing idiom". The real convention is jsdom + `createRoot` + `act`
   from `"react"`. Worth a note to the planner.

---

## Deliberately deferred — each with its reason, none faked

| Deferred | Reason |
|---|---|
| **The tree widget** | **D-66-08.** taste-references bans a folder-tree sidebar without real depth; a tree's unique value over drill-down is drag-into-folder and cross-branch jumps, and **move/copy is OUT**, so it earns only a third permanent pane (tell #5). Breadcrumb + `?path=` + drill-down already satisfy FVLT-01's own words. **The one decision to veto if you disagree — it is legible and reversible.** |
| **Preview / Quick Look** | D-66-04. The allowlist posture is DECIDED (`image/png|jpeg|gif|webp`, `application/pdf`; **never** `text/html`, **never** `image/svg+xml`) so no future phase improvises it. The selection state built tonight is its seam. |
| **Multi-select** | Needs a selection model + a toolbar-at-≥2; the single-selection grammar is the seam. Phase 63's canon curation wants it — build it there. |
| **Rename, move/copy** | Storage has no move; both are copy+delete, which needs progress and rollback of its own. |
| **Search** | D-66-01: no metadata table ⇒ no global search. The honest cost of zero schema. |
| **Share links, quotas, trash/undelete** | Out per `<domain>`. **Trash is the load-bearing one:** it is what makes delete irreversible and therefore what earns the confirm + the madder. Add trash and the dialog must go. |
| **Pagination past 500** | The listing caps at 500 (asserted). The delete walk PAGES past it — the cap is a UI bound, not a data bound. |
| **`@shadcn/empty`, `@kibo-ui/tree`** | D-66-09 — `packages/ui` is not this lane's path. Shopping list, deferred not rejected. |
| **Audit log** (T-66-10/T-66-15) | Single-user self-cloud; storage keeps `created_at`/`updated_at`. **Not optional if the vault ever gains sharing.** |

## Deviations from plan (Plan 04's own; see 01–03's SUMMARYs for theirs)

1. **[Rule 1 — Bug] The law gate's two bugs.** See D-66-15.
2. **[Rule 1 — Bug] `VaultListing` gained a `leadingRow` slot.** Wiring the inline new-folder row by
   wrapping `VaultListing` in the caller's own `<ul>` nested `<ul>` inside `<ul>` (invalid HTML) and
   — worse — put the new row **outside** the element carrying the roving-tabindex key handler. The
   slot keeps one `<ul>` and one keyboard owner.
3. **[Rule 3 — Blocking] Test harness is `createRoot`+`act`, not RTL.** Carried from Plan 03; RTL is
   not installed and installing it is orchestrator-reserved. Every assertion the plan asked for is
   present against the real DOM.
4. **[Gap, stated not faked] The tray has DISMISS, not RETRY.** The plan specifies a per-file
   "Retry" on a failed row. Retrying needs the original `File` handle kept alive past the failure,
   and the queue does not retain one — adding a `Map<id, File>` that outlives the batch is a real
   decision about how long the vault pins a user's file in memory after it has already failed, not
   a line to tack on at the end of a plan. So: the failed row persists with **the reason named**,
   dismiss clears it, and re-dropping the file is the path. **The plan's copy line "Upload failed —
   {reason}." + "Retry" is half-delivered.** An earlier draft exported a `retry` from the hook that
   no component called — removed, because a dead export advertising a capability is worse than an
   admitted gap: the next reader believes it. **Backlog.**

## Threat register — final status

| Threat | Disposition | Proven by |
|---|---|---|
| T-66-01/02 (traversal, elevation) | mitigated | `vault-keys` message-level tests; `files-tenancy` impersonation; two negative proofs |
| T-66-03/07 (info disclosure) | mitigated | `{ url }` only; generic errors; storage text logged server-side |
| T-66-04 (spoofing) | mitigated | five written-out UNAUTHORIZED cases + `publicProcedure` source ban |
| T-66-05 (DoS) | mitigated | 3 layers, one constant; over-cap file never reaches the network |
| T-66-06 (XSS) | mitigated | law gate bans `dangerouslySetInnerHTML` **including tests**; no preview; attachment disposition for all types |
| T-66-09 (destructive) | mitigated | tenancy proof on the recursive walk + cycle guard |
| T-66-11 | mitigated | law gate bans `SERVICE_ROLE` under `files/` **including tests** |
| T-66-13 | mitigated | write test asserts `requestUpload` receives no `key`/`userId`/`bucket`/`prefix` |
| T-66-14 | mitigated | window-level `preventDefault`, detached on unmount |
| T-66-10/15 (repudiation) | **accept** | No audit log, no trash. **Both become unacceptable if sharing ships.** |
| T-66-SC (supply chain) | **accept** | **Zero new packages.** |

### Threat Flags
None. No new network endpoint, auth path, or trust-boundary schema beyond the plans' registers.

## Self-Check: PASSED

All ten files exist; `af0af4f` in `git log`; `npx tsc --noEmit` clean for `apps/web` and
`packages/api-client`; full suites green (1073 web / 536 api-client); `git status --short` clean
outside owned paths. **`packages/ui/**`, `role-hue-ban.test.ts`, `root.ts`, `globals.css`, every
`package.json`, and `package-lock.json` are untouched.**
