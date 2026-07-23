# OneDrive → polytoken vault migration — design

**Status:** design only (no migration code in this batch).
**Author lane:** b5-drive-ops. **Depends on:** DR-01 (move), DR-02 (versioning + trash), DR-04 (quota/usage).
**Scope of the worked example:** one user, ~500 GB, ~200k objects (the realistic shape of a long-lived OneDrive).

This document specifies how a bulk import from OneDrive lands in the vault built by this batch. It reuses the vault's existing seams verbatim — the storage-adapter blob store, the `vaultKey` chokepoint, `requestUpload`'s versioning-on-overwrite, and the DR-04 quota — rather than inventing a parallel ingest path. Everything below is a plan; nothing here ships as code this batch.

---

## 0. The seams this rides on (so the design stays honest)

| Vault fact (this batch) | What the migration is allowed to assume |
|---|---|
| Blobs live in Supabase Storage under `{userId}/…`; the ONLY key builder is `vaultKey` (`vault-keys.ts`). | The importer never constructs a key. It calls `requestUpload({ path, name, size })` and PUTs to the signed URL — the same two-door funnel the UI uses. |
| `requestUpload` snapshots the prior blob into `.versions/<id>` on overwrite (DR-02) and writes a `file_versions` row. | Re-importing a changed file **is** a version. The importer does not special-case versioning; it falls out of the upload path (§5). |
| `requestUpload` soft-blocks at `VAULT_QUOTA_BYTES` (DR-04, live-bytes only). | 500 GB will NOT fit the 5 GB default quota. The quota is a real gate the importer must plan around (§6), not bypass. |
| `folderSizeRollup` / `usageSummary` are the one usage aggregate. | Progress ("142 of 500 GB imported") reads the same number the meter shows. |
| `VAULT_MAX_UPLOAD_BYTES = 100 MB` per object (server + bucket). | Objects over 100 MB need chunking that the CURRENT signed-URL path does not offer — a real gap (§4, §8). |

Two of these — the 5 GB quota and the 100 MB per-object cap — are the load-bearing constraints. A 500 GB import is a **policy** decision (raise the quota) and a **capability** decision (large-object chunked upload) before it is a throughput decision. This doc calls both out rather than hiding them behind an estimate.

---

## 1. Architecture

```
OneDrive (Microsoft Graph)                     polytoken
┌────────────────────────┐   delta+download   ┌─────────────────────────────┐
│ /me/drive/root         │ ─────────────────▶ │ import worker (daemon or     │
│  delta  → change pages │                    │ listener job) — NOT the web  │
│  /content → bytes      │ ◀───── 401 refresh │ request path                 │
└────────────────────────┘                    │                             │
                                               │  1. manifest (Graph delta)  │
      content-addressed store (CAS)            │  2. dedupe by sha256 (CAS)  │
      keyed by sha256 ──────────────────────── │  3. requestUpload + PUT     │
                                               │  4. verify checksum         │
                                               │  5. checkpoint (resume)     │
                                               └─────────────────────────────┘
```

**The worker is not the web request path.** A 500 GB import is hours-to-days of I/O; it belongs to the **daemon** (`apps/daemon`, already the fs/backup home — DR-06's substrate) or a **listener job** (`apps/email-listener`, already has long-running extraction workers). The web app's role is: start/pause/resume the job and render progress from `usageSummary` + a job-status row. This mirrors DR-06's "daemon `fs.read` → `requestUpload`" chain, with OneDrive-over-Graph standing in for the local filesystem.

**Identity.** The worker acts as one `userId` and holds (a) a Microsoft Graph OAuth token for the source and (b) the ability to call `files.requestUpload` as that user. It never touches another tenant's keys — `vaultKey` guarantees that structurally, exactly as for interactive uploads.

---

## 2. Manifest / download strategy — Graph `delta`, not a recursive walk

Enumerate with the **Microsoft Graph delta query**, not a recursive `children` crawl:

```
GET /me/drive/root/delta        → page 1 … page N  (+ @odata.deltaLink)
```

Why delta:
- **One pass, paged, restartable.** Each page carries a `@odata.nextLink`; the terminal `@odata.deltaLink` is a cursor you persist. A crash resumes from the last `nextLink`, and a *second run days later* resumes from the `deltaLink` to pick up only what changed — which is what makes this an ongoing sync (DR-06) and not a one-shot.
- **Per-item metadata for free:** `id`, `name`, parentReference `path`, `size`, `lastModifiedDateTime`, and crucially **`file.hashes` (`quickXorHash`, and `sha256Hash`/`sha1Hash` on personal accounts)**. The hash lets §3 dedupe and §4 verify **without downloading first**.

The manifest is a durable table the worker owns (proposed shape, worker-local — NOT the vault schema):

```
import_items(
  job_id, graph_id, rel_path, name, size_bytes,
  remote_hash TEXT, remote_hash_algo TEXT,     -- from file.hashes
  content_sha256 TEXT,                          -- filled after download/verify
  state ENUM(pending, downloading, uploading, verified, skipped_dupe, failed),
  attempts INT, last_error TEXT, updated_at
)
```

Download bytes only when the item is not already resolvable by hash (§3). Fetch content with `GET /me/drive/items/{id}/content` (302 → CDN URL); stream to a temp spool, never buffer 100 MB+ in memory.

**Folders:** OneDrive folders are implicit in the vault too (D-66-01) — a folder "exists" once a child lands under it. The importer maps OneDrive `parentReference.path` → vault `path` segments and lets the child upload materialize the folder. Genuinely-empty OneDrive folders (rare, and worth preserving) get a `createFolder({ path, name })` call. `rel_path` segments are re-validated by `VaultPathSchema` before use — a OneDrive name that violates a vault rule (trailing dot, control char, a reserved `.versions`/`.trash` collision) is **sanitized and logged**, never silently dropped.

---

## 3. Content-addressed dedupe (CAS) — sha256 is the key

OneDrive at 500 GB is full of duplicates (the same PDF mailed to five folders, `Copy of Copy of budget.xlsx`). Deduping is the single biggest cost lever.

**Mechanism:** a content-addressed side table keyed by `content_sha256`:

```
cas_objects(user_id, content_sha256 PRIMARY, size_bytes, first_vault_path, created_at)
```

Per item:
1. Prefer the **Graph-provided hash**. Personal accounts expose `sha256Hash` directly → zero-download dedupe. Business accounts expose only `quickXorHash` → use it as a *cheap pre-filter* (equal quickXor ⇒ candidate), then confirm with a real sha256 computed during download.
2. If `content_sha256` is already in `cas_objects` for this user → **skip the upload**, and instead record a lightweight reference so the file still appears at its OneDrive path.

**How a "reference" appears at a second path without a second blob** is a real design fork, stated honestly:

- **Option A — copy the blob (simple, correct today).** The second path gets its own blob via the existing upload path. Dedupe then only saves *download + hash*, not *storage*. Zero new concepts. **Recommended for v1** — it needs nothing this batch didn't build.
- **Option B — true single-instance store (a new concept, deferred).** A `vault_links` table pointing many logical paths at one CAS blob; the storage-adapter learns to resolve a link on download/delete. This is real dedupe-at-rest but it changes the vault's "a path is a blob" invariant and interacts with DR-02 delete/restore (deleting one link must not evict a blob another link still needs — reference counting). **Explicitly out of scope**; recorded as the follow-on if storage cost, not import time, becomes the pain.

Either way, CAS collapses the *work*: identical bytes are hashed once and (Option A) uploaded once per distinct path, (Option B) stored once total.

---

## 4. Resumable, chunked upload — the 100 MB gap, named

The current `requestUpload` mints a **single** signed URL and the browser PUTs the whole object. That is fine to `VAULT_MAX_UPLOAD_BYTES` (100 MB) and **cannot** carry a 4 GB video. A 500 GB drive certainly contains objects over 100 MB. So the migration needs a capability the interactive vault does not yet have:

**Proposed `requestUploadSession` (design, not built):** a sibling of `requestUpload` that returns a Supabase **resumable (TUS) upload** handle for objects above a threshold. Supabase Storage supports TUS resumable uploads; the worker uploads in 5–50 MB chunks, and a mid-object crash resumes from the last acknowledged offset rather than restarting the object. This procedure obeys every existing rule: `vaultKey`-derived key, `ctx.user.id`, quota checked up front, versioning-on-overwrite honored (the session targets the same live key). It is the ONE new server seam a real 500 GB import requires, and it is where DR-06's "scheduled backup of large folders" also lands — so it is built once for both.

**Resumability has two layers, and both matter:**
- **Within an object** — TUS offset (above), for the 4 GB file that dies at 3.2 GB.
- **Across the job** — the manifest `state` column. The worker checkpoints after every `verified` item. A killed worker (or a `pause`) restarts, reads the manifest, and continues from the first non-`verified` row. Combined with the Graph `deltaLink`, the whole job is idempotent: re-running it is a no-op for already-`verified` items and a delta-fetch for anything that changed at the source.

**Concurrency:** a bounded pool (e.g. 8 in-flight objects) balances Graph throttling (429 + `Retry-After`, which the worker MUST honor) against upload bandwidth. Small objects (< 100 MB) go through the plain `requestUpload` path; large ones through the session path. One work queue, two lanes.

---

## 5. Integrity verification — checksum end to end

Never trust "the PUT returned 200." Verify per object:

1. **Source hash** from Graph `file.hashes` (recorded in the manifest before download).
2. **Transit hash:** compute `sha256` **while streaming** the download to the spool (single pass, no re-read). Compare against the source hash where the algorithms match (personal: sha256 directly; business: sha256 is the ground truth, quickXor was only the pre-filter). A mismatch here = a corrupt/truncated download → retry, do not upload.
3. **Post-upload hash:** after the PUT/session completes, issue a `requestDownload` HEAD or a ranged read and confirm the stored object's size (and, if the bucket exposes an ETag/md5, its checksum) matches. Only then mark the manifest row `verified`.
4. **Store `content_sha256`** on the manifest + CAS row, so re-runs and future syncs dedupe against a hash we computed ourselves, not one we were told.

This makes the import **auditable**: "500 GB imported, 200,003 objects, 200,003 verified, 0 mismatches" is a statement backed by a hash per object, not by an absence of errors.

---

## 6. How versioning-on-import interacts with DR-02

This is the subtle part, and it is already handled by the seam DR-02 built:

- **First import of a path** → `requestUpload` finds nothing at the target (`statEntry` → null), snapshots nothing, mints the URL. Clean create. No version row.
- **Re-import of a CHANGED file** (same path, new bytes — a second sync run, or a file edited in OneDrive after the first pass) → `requestUpload` finds the live blob, **snapshots it into `.versions/<id>` and writes a `file_versions` row (state=version)** *before* handing back the URL. The new bytes overwrite the live key; the prior import becomes a restorable version. **Import history is version history, for free** — the user can roll back to "the copy as it was in OneDrive on the first sync."
- **Re-import of an UNCHANGED file** (same `content_sha256`) → CAS (§3) skips it entirely. No upload, no spurious version. This is why dedupe and versioning must both key on the *content hash*, not on `lastModifiedDateTime` (which OneDrive bumps on metadata-only changes): hashing is what stops every re-sync manufacturing a junk version of every unchanged file.
- **Deletes at the source.** A delta page can report a `deleted` facet. Policy (design choice): a source-side delete triggers the vault's **soft-delete** (`files.remove` → `.trash`, DR-02), never a hard delete — so a file removed in OneDrive is recoverable from vault Trash for the retention window. Destructive source changes never become destructive vault changes without the trash safety net. This is exactly the property DR-06 lists ("versioning is what makes backup non-destructive").

**Net:** the importer writes ZERO new versioning logic. It uploads through `requestUpload`; DR-02 does the rest. The only importer-side rule is "dedupe by content hash first," which is what keeps versioning meaningful instead of noisy.

---

## 7. Quota interaction (DR-04)

500 GB ≫ the 5 GB default `VAULT_QUOTA_BYTES`. The importer must not paper over this:

- **Pre-flight:** sum the manifest's `size_bytes` (post-dedupe, live bytes only) and compare against `usageSummary().availableBytes`. If it will not fit, the job **refuses to start** with a clear number ("this import needs 480 GB; your limit is 5 GB — raise it to continue"), rather than soft-blocking two days in at 5 GB with 495 GB still queued.
- **Quota is per-user policy**, not a per-import flag: a 500 GB import is a decision to give this user a 500 GB (or larger) quota, made once, in Settings (ST-01) / an admin action — `VAULT_QUOTA_BYTES` becomes a per-user column rather than a constant. That is the honest prerequisite, and it is small (one column + read it in `usageSummary`/`requestUpload` instead of the constant).
- **Parked bytes don't count** (DR-04 decision): versions created during re-syncs and trashed source-deletes are retention grace, not billed — so an import that re-runs weekly does not slowly consume the user's quota with its own version history. Good default; revisit only if parked bytes dominate.

---

## 8. Throughput & cost estimate (order-of-magnitude)

Assumptions: ~500 GB, ~200k objects, ~25% duplicate bytes (typical for a personal OneDrive), 8-way concurrency, verification streamed (no extra read pass for hashing).

| Lever | Estimate | Note |
|---|---|---|
| Bytes after dedupe | ~375 GB | 25% collapsed by CAS (§3) — the biggest single win. |
| Effective throughput | ~40–80 Mbps sustained | Bounded by the **min** of Graph download, the worker's egress, and Supabase ingest; Graph **throttling (429)** is usually the ceiling, not raw bandwidth. |
| Wall-clock (375 GB @ 60 Mbps) | **~14–15 hours** | Continuous. With pauses / throttling backoff, plan **1–2 days**. |
| Graph API calls | ~200k content GETs + ~a few hundred delta pages | Watch the per-app throttle; honor `Retry-After`. |
| Storage cost (at rest) | 375 GB × Supabase Storage $/GB-mo | Option A (§3) stores 375 GB; Option B would store ~300 GB (dedupe-at-rest) — the delta is the only reason to build Option B. |
| Egress cost | ~500 GB **from** OneDrive (Microsoft side, typically free to the user) + 375 GB **into** Supabase | Ingress to Supabase is generally free; the meaningful recurring cost is storage-at-rest, not the one-time transfer. |
| Compute | 1 worker, streaming hash — CPU-cheap (sha256 at line rate is ~500 MB/s/core) | Hashing is not the bottleneck; network is. |

**Takeaway:** dedupe (§3) and honoring Graph throttling (§4) dominate wall-clock; storage-at-rest dominates recurring cost. The transfer is a ~1–2 day background job, not an interactive operation — which is why it lives in the daemon/listener, checkpoints per object, and reports progress through the DR-04 meter the user already understands.

---

## 9. What must be built before a real 500 GB import (the honest gap list)

1. **`requestUploadSession`** (resumable/chunked, > 100 MB objects) — the one new server seam (§4). Shared with DR-06.
2. **Per-user quota** — `VAULT_QUOTA_BYTES` becomes a column; `requestUpload`/`usageSummary` read it (§7). Small.
3. **The import worker** — Graph delta client + manifest + CAS + verify + checkpoint loop, in the daemon or listener (§1–5). The bulk of the work, but it composes existing pieces.
4. **A job-status surface** — start/pause/resume + progress from `usageSummary` + manifest counts (§1).

Everything else — the keying, the versioning, the trash safety net, the usage aggregate — is what this batch (DR-01/02/04) already shipped. The migration is mostly *orchestration over seams that now exist*, plus the two capability gaps (large-object upload, per-user quota) named above.
