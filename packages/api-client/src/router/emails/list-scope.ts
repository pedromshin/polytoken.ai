/**
 * list-scope.ts — the shared importer-scope decision for every list-style
 * emails read (`list`, `listThreads`).
 *
 * Extracted from index.ts (Phase 45 Plan 04) so `listThreads` can reuse the
 * exact same scoping decision as `list` without a circular import between
 * index.ts and the new list-threads.ts module. Re-exported from index.ts so
 * existing `import { resolveListScope } from "../index"` call sites (e.g.
 * emails-user-scoping.test.ts) keep working unchanged.
 */

/**
 * resolveListScope — decides which importer ids a list-style emails read is
 * allowed to query, given the caller's server-verified owned set and an
 * optional client-supplied `importerId` filter (TENA-03 / T-44-05-01).
 *
 * - No requested importerId: scope to the caller's FULL owned set.
 * - Requested importerId is IN the owned set: narrow to just that one id (an
 *   explicit filter the caller asked for, validated against ownership first).
 * - Requested importerId is NOT in the owned set (or the caller owns
 *   nothing): `{ ok: false }` — the caller must get an empty result, never a
 *   query built from an unverified id.
 *
 * Exported for DB-free unit testing (same idiom as `shapeGalleryItem` /
 * `aggregateEntitySummary` elsewhere in this router).
 */
export function resolveListScope(
  owned: ReadonlyArray<string>,
  requestedImporterId: string | undefined,
):
  | { readonly ok: true; readonly importerIds: ReadonlyArray<string> }
  | { readonly ok: false } {
  if (owned.length === 0) {
    return { ok: false };
  }
  if (requestedImporterId === undefined) {
    return { ok: true, importerIds: owned };
  }
  if (!owned.includes(requestedImporterId)) {
    return { ok: false };
  }
  return { ok: true, importerIds: [requestedImporterId] };
}
