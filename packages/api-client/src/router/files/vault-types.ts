/**
 * vault-types.ts — the /files vault's vocabulary (Phase 66 Plan 01, D-66-01).
 *
 * TYPES ONLY. Zero runtime code, and — deliberately — zero imports from
 * `@supabase/supabase-js`: D-66-02 keeps that import in exactly ONE file
 * (`service-client.ts`, Plan 02). `VaultStorageClient` below is a STRUCTURAL
 * declaration of the five storage methods the vault uses, which is what lets
 * `storage-adapter.ts` be tested against a ~40-line in-memory fake with no
 * Supabase, no env, and no network.
 *
 * `VaultEntry` is the one shape that crosses the wire AND reaches the rows.
 * `kind` is derived server-side (storage-adapter.ts) so the surface never
 * re-derives it: two maps of one fact drift (brand-guide §3).
 */

/**
 * A file kind. Rendered as GLYPH GEOMETRY, never as a hue (D-58-01 law 3,
 * D-66-05). There is no per-kind colour anywhere in this product; adding one
 * is the "colour-coded file types" anti-generic tell.
 */
export type VaultKind =
  | "folder"
  | "text"
  | "image"
  | "archive"
  | "audio"
  | "video"
  | "file";

/** The canonical wire + display shape. Plan 03 imports this type-only. */
export type VaultEntry = {
  /** Basename. Rendered SANS — file names are METADATA/chrome (D-66-05). */
  readonly name: string;
  /** Glyph geometry only — never a hue (law 3). */
  readonly kind: VaultKind;
  readonly isFolder: boolean;
  /** null on folders — the cell is EMPTY, not "0 B". */
  readonly size: number | null;
  /** ISO. The surface formats it absolute ("12 Jul 2026", D-66-05). */
  readonly updatedAt: string | null;
  /**
   * STORED, never trusted for a rendering decision (D-66-04). Downloads are
   * attachment-disposition for every content type; there is no inline preview.
   */
  readonly contentType: string | null;
};

/**
 * The raw shape Supabase Storage's `.list()` returns.
 *
 * `id === null` MEANS THIS IS A FOLDER — that is the whole of folder
 * detection, and it is why D-66-01 needs no metadata table.
 */
export type RawFileObject = {
  /** Basename only, NOT the full key. */
  readonly name: string;
  /** null ⇒ folder. */
  readonly id: string | null;
  readonly updated_at: string | null;
  /** null on folders. */
  readonly metadata: { readonly size: number; readonly mimetype: string } | null;
};

/**
 * The injected seam — declared structurally so it is satisfied by both the
 * real `client.storage.from(bucket)` and the test fake.
 *
 * Every method resolves `{ data, error }` and NEVER throws; the adapter is
 * what turns a non-null `error` into a thrown `VaultStorageError`.
 */
export type VaultStorageClient = {
  list(
    prefix: string,
    opts: {
      limit: number;
      offset: number;
      sortBy: { column: string; order: string };
    },
  ): Promise<{ data: RawFileObject[] | null; error: { message: string } | null }>;

  createSignedUrl(
    path: string,
    expiresIn: number,
    opts?: { download?: string },
  ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;

  createSignedUploadUrl(
    path: string,
  ): Promise<{
    data: { signedUrl: string; token: string; path: string } | null;
    error: { message: string } | null;
  }>;

  upload(
    path: string,
    body: ArrayBuffer | Blob | Uint8Array,
    opts?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;

  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};
