# Phase 66 — Schema Request: ONE BUCKET, ZERO TABLES

**This request contains ZERO tables.** Do not queue a migration for Lane D; do not run
`drizzle-kit generate` on this lane's behalf. There is nothing to generate.

That is a design decision, not an omission. D-66-01: Supabase Storage's `list(prefix)` already
returns one level of the tree — folders arrive as entries with `id: null`, files carry
`metadata.size` / `metadata.mimetype` / `updated_at` — so a lazy per-folder listing IS a real
folder tree with no schema at all. A metadata table would have put this lane in the migrations
queue and coupled tonight's merge to the orchestrator's migration sequencing, which is the exact
failure mode that destroyed work in v1.6 (journal collisions).

**Accepted trade-offs** (all backlog, none faked): no global search, no per-file custom metadata,
no server-side sort beyond `list()`'s, and folders are implicit — a folder exists iff it contains
an object, so "New folder" writes a zero-byte `.emptyFolderPlaceholder` (the Supabase dashboard's
own convention, filtered from every listing).

---

## The bucket

| Setting | Value |
|---|---|
| **Name** | `user-files` |
| **`public`** | `false` — always |
| **`fileSizeLimit`** | `104857600` (100 MB) |
| **`allowedMimeTypes`** | **unrestricted** (null) |

### `public: false`, always

A public bucket makes every signed-URL guarantee in this phase theatre. The vault's entire tenancy
argument is that objects are reachable only through a `protectedProcedure` that derives the key
from `ctx.user.id`; a public bucket routes around that argument completely, and it does so silently
— nothing in the app would fail, or even look different.

### `fileSizeLimit: 100 MB` — and it must move in lockstep

This mirrors **`VAULT_MAX_UPLOAD_BYTES` in `packages/api-client/src/router/files/storage-adapter.ts`**,
which is the ONE definition of the cap (T-66-05). Three layers enforce it and they cite one constant:

1. the client pre-check (Plan 04) — a courtesy, so the user is told before a 100 MB transfer, never the control;
2. the server's `requestUpload` input schema `.max(VAULT_MAX_UPLOAD_BYTES)` — the enforcement;
3. **this bucket limit** — the layer the client cannot lie past at all, because the browser PUTs
   directly to storage on a signed URL.

**If you change one, change all three.** A bucket limit below the constant surfaces as a user
watching a large upload run to 100% and *then* fail — the worst possible place to discover a bound.

### `allowedMimeTypes: unrestricted` — the reason, so this does not read as an oversight

This is the user's own cloud drive. A self-cloud that refuses `.dwg`, `.sketch`, or some format
nobody has invented yet is broken as a product — this is the OneDrive exit, and an upload allowlist
is the thing being exited.

Safety does not come from guessing at extensions. It comes from two structural facts:

- **Every download URL is minted with `download: <filename>`** — attachment disposition, ALL content
  types, no exceptions (`signedDownloadUrl`, storage-adapter.ts). The browser saves the file; it
  never renders it on our origin.
- **There is no inline preview at all** (D-66-04). No uploaded byte is ever interpreted.

A declared `contentType` is stored and is **never trusted for a rendering decision**. When preview
eventually arrives it may inline ONLY an allowlist — `image/png`, `image/jpeg`, `image/gif`,
`image/webp`, `application/pdf` — and **NEVER `text/html`, NEVER `image/svg+xml`** (both are script
carriers; an SVG is a document with `<script>` in it). That posture is decided now so a future phase
does not improvise it at 2am.

### RLS / policies: none needed — and adding one is a downgrade

Objects are reached ONLY through the service-role client behind `protectedProcedure`
(the `apps/web/src/app/api/attachments/[id]/route.ts` precedent). The bucket needs no anon policy
and no authenticated policy.

**The tripwire, recorded as such:** if an anon/authenticated policy is ever added to this bucket,
tenancy degrades from *"impossible by construction"* to *"depends on a policy being right."* Those
are different security properties. The first is proven by
`packages/api-client/src/router/files/__tests__/` (68 tests, two of them negative proofs); the
second is proven by nothing and reviewed by no one.

### Env: no new secret

`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — **both already present and already used** by the
attachments route. The vault adds no new secret to any environment. Worth stating plainly: it is one
less thing to arrange at merge, and one less thing to rotate later.

---

## Creating the bucket

Dashboard (Storage → New bucket), or:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 104857600, null)
on conflict (id) do nothing;
```

Needs to exist in **local, staging, and production** before `/files` works in that environment.

---

## Hand-over: the verification only YOU can run

This lane has no live bucket (worktree, no dev server, no shared Supabase — LANE-CONTRACTS protocol
3/4), so every test here runs against an in-memory fake. **The fake proves the logic; it cannot
prove the bucket.** These steps are the difference, and they are the first time this code will have
touched real storage.

1. **Create the bucket** in the local environment, per the config above. Confirm
   `public = false` in the dashboard — read it, do not assume it.
2. **Wire the router**: add `files: filesRouter` to `packages/api-client/src/root.ts`
   (see `66-02-SUMMARY.md`) and add `@supabase/supabase-js` to
   `packages/api-client/package.json`. Without both, `/files` renders but every query fails.
3. **Sign in** and open `/files`. Expect the empty state — "Drop a file anywhere to start your
   vault" — not an error and not a spinner that never resolves.
4. **Upload one file** by dragging it anywhere onto the pane.
5. **Confirm the object's key** in the Supabase dashboard (Storage → `user-files`). It MUST be
   `{your-user-id}/{filename}` — a top-level object with your user id as its first path segment.
   If the file landed at the bucket ROOT (no user prefix), STOP: that is the fail-open case
   `vaultKey`'s blank-userId guard exists to prevent, and it means the acting user was lost
   somewhere in the wiring.
6. **Create a folder**, then confirm a `.emptyFolderPlaceholder` object appeared beneath it and that
   it does NOT appear as a row in the UI.
7. **Download the file.** Confirm the browser SAVES it rather than rendering it — test with a
   `.txt` or an `.html` file specifically, since those are the ones a browser would happily
   display inline if the attachment disposition were missing.
8. **The cross-tenant check** (the one that matters): sign in as a SECOND user, open `/files`, and
   confirm the first user's file and folder are **not visible**. Then, still as the second user,
   try `/files?path=../{first-user-id}` in the address bar and confirm it lands on the second
   user's own empty vault — not an error page, and not the first user's files.
9. **Delete the folder** and confirm every object beneath it is gone from the dashboard, not just
   the top level.
