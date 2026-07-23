/**
 * vault-keys.ts — the /files vault's key chokepoint (Phase 66 Plan 01, D-66-07).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE CLAIM: a storage key for user A can never address user B's objects,
 * whatever the client sends — because exactly ONE function builds keys, and it
 * re-validates every segment itself.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE RULE THIS ENCODES: the server NEVER accepts a full storage key from the
 * client — only validated relative segments. `vaultKey`'s first argument is
 * only ever `ctx.user.id` (a `protectedProcedure` guarantee, trpc.ts), never
 * an input field. No procedure input may name a `userId`, `key`, `bucket`, or
 * `prefix`; if a future need seems to call for one, that is the signal to
 * stop, not to add the field.
 *
 * ON THE DELIBERATE DUPLICATION — DO NOT "OPTIMIZE" IT AWAY:
 * `vaultKey` re-parses its segments through `VaultPathSchema` even though the
 * router will already have parsed the same input through the same schema a
 * moment earlier. That looks redundant and it is not: it is what makes the
 * guarantee STRUCTURAL rather than a promise about call order. A future caller
 * that forgets to validate — a script, a job, a new procedure written at 2am —
 * still cannot produce an escaping key. Deleting the re-parse converts this
 * module from a chokepoint into a convention.
 *
 * ON THE REFINES BEING SEPARATE — ALSO DELIBERATE:
 * one `.refine()` per rule, each with its own message, so a failure names the
 * rule it broke and so each rule is independently testable (the test file
 * asserts on MESSAGES for exactly this reason — see its header). The rules
 * could collapse into one dense regex. They must not: the next reader has to
 * audit them one at a time, and a single clever regex is precisely where a
 * traversal hole hides in plain sight.
 */

import { z } from "zod";

/**
 * The zero-byte object that makes an otherwise-empty folder exist.
 *
 * D-66-01: folders are IMPLICIT — a folder exists iff it contains an object —
 * so "New folder" writes one of these. The name is the Supabase dashboard's
 * own convention, so a folder created here looks identical to one created
 * there. It is our bookkeeping: the schema rejects it as a user-supplied name
 * (a user who could mint one could fabricate a phantom folder), and the
 * adapter filters it out of every listing.
 */
export const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";

/**
 * RESERVED SYSTEM PREFIXES (DR-02).
 *
 * The vault is blob-only (D-66-01): there is no metadata table for live
 * objects, so versioning + trash need somewhere to PARK a blob that is no
 * longer live. These two dot-prefixed folders under `{userId}/` are that park,
 * and they are OURS:
 *   - `.versions/<snapshotId>` — a prior copy of an object that was overwritten.
 *   - `.trash/<snapshotId>`    — an object (or a folder subtree) that was
 *     soft-deleted and is awaiting restore-or-expiry.
 *
 * They are dot-prefixed to sit out of the way, but that is cosmetic. What makes
 * them SYSTEM is the pair of guarantees below:
 *   (1) the name schema REJECTS them as a user-supplied name (RESERVED), so a
 *       user can never create a folder that collides with the park; and
 *   (2) `storage-adapter.listFolder` FILTERS them out of every listing, so the
 *       park never appears as a row the user could walk into or delete.
 * A `file_versions` DB row (migration 0045) remembers, for each parked blob,
 * the object it belongs to and where it came from — the park itself is flat.
 */
export const VAULT_VERSIONS_PREFIX = ".versions";
export const VAULT_TRASH_PREFIX = ".trash";

/**
 * Every name the vault reserves for its own bookkeeping. A user-supplied
 * segment equal to any of these is refused (RESERVED), and the listing filter
 * drops them. One set, referenced by both the schema and the adapter — two
 * lists of one fact drift.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  EMPTY_FOLDER_PLACEHOLDER,
  VAULT_VERSIONS_PREFIX,
  VAULT_TRASH_PREFIX,
]);

/** Max path depth. A bound, so a crafted 10k-deep path is not a listing amplifier. */
export const VAULT_PATH_MAX_DEPTH = 32;

/** Max name length, in UTF-16 code units. */
export const VAULT_NAME_MAX_LENGTH = 255;

/**
 * One message per rule. Exported so the tests can assert WHICH rule fired
 * rather than merely that something did — the rules overlap, and a test that
 * only checks "rejected" stays green when the traversal guard is removed.
 */
export const VAULT_NAME_RULES = {
  EMPTY: "A name can't be empty.",
  TOO_LONG: `A name can't be longer than ${VAULT_NAME_MAX_LENGTH} characters.`,
  DOT_SEGMENT: 'A name can\'t be "." or "..".',
  SEPARATOR: "A name can't contain a path separator.",
  CONTROL_CHAR: "A name can't contain control characters.",
  RESERVED: "That name is reserved.",
  EDGE_SPACE: "A name can't start or end with a space.",
  TRAILING_DOT: "A name can't end with a period.",
} as const;

/** Control characters: C0 (NUL..US) and DEL. NUL truncates; LF/CR inject. */
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/**
 * A single path component — one folder name or one file name.
 *
 * Each rule stands alone and says why it exists. Read them one at a time;
 * that is the point of them being separate.
 */
export const VaultSegmentSchema = z
  .string()
  // Empty: an empty segment collapses "a//b" into "a/b" — a name that is not
  // the name the caller thinks it is.
  .refine((s) => s.length > 0, VAULT_NAME_RULES.EMPTY)
  .refine((s) => s.length <= VAULT_NAME_MAX_LENGTH, VAULT_NAME_RULES.TOO_LONG)
  // THE TRAVERSAL GUARD. ".." walks up out of `{userId}/` and into another
  // user's data; "." is a no-op segment that makes two distinct keys address
  // one object. Removing this refine is the single most dangerous edit that
  // can be made to this file.
  .refine((s) => s !== "." && s !== "..", VAULT_NAME_RULES.DOT_SEGMENT)
  // Separator smuggling, both platforms: a segment containing "/" or "\" is
  // not a segment, it is a path — and a path from the client is exactly what
  // this module exists to refuse.
  .refine((s) => !s.includes("/") && !s.includes("\\"), VAULT_NAME_RULES.SEPARATOR)
  .refine((s) => !CONTROL_CHAR_RE.test(s), VAULT_NAME_RULES.CONTROL_CHAR)
  // Every reserved system name (the empty-folder placeholder AND the DR-02
  // `.versions` / `.trash` parks) is refused as a user-supplied name — a user
  // who could mint one could collide with, or masquerade as, the vault's own
  // bookkeeping. The message stays RESERVED so a rejection still names the rule.
  .refine((s) => !RESERVED_SEGMENTS.has(s), VAULT_NAME_RULES.RESERVED)
  // Edge spaces and trailing periods round-trip badly across clients and
  // filesystems: the user ends up with a file they can see and cannot address.
  // A usability rule, not a security one — stated here so nobody later
  // "hardens" it into something it is not.
  .refine((s) => s === s.trim(), VAULT_NAME_RULES.EDGE_SPACE)
  .refine((s) => !s.endsWith("."), VAULT_NAME_RULES.TRAILING_DOT);

/**
 * The same schema, aliased. `VaultNameSchema` reads correctly at a call site
 * that names a FILE; `VaultSegmentSchema` reads correctly at one that names a
 * path component. One rule set, two honest names — never two schemas.
 */
export const VaultNameSchema = VaultSegmentSchema;

/** A path: validated segments, depth-capped, defaulting to the vault root. */
export const VaultPathSchema = z
  .array(VaultSegmentSchema)
  .max(VAULT_PATH_MAX_DEPTH, `A path can't be deeper than ${VAULT_PATH_MAX_DEPTH} folders.`)
  .default([]);

export type VaultPath = z.infer<typeof VaultPathSchema>;

/**
 * THE ONLY PLACE A STORAGE KEY IS BUILT.
 *
 * @param userId - ALWAYS `ctx.user.id`. Never an input field, ever.
 * @param segments - client-supplied, hostile, and re-validated here.
 * @throws if `userId` is blank or any segment breaks any rule above.
 */
export function vaultKey(userId: string, segments: readonly string[]): string {
  // FAIL-OPEN GUARD. Without this, a bug upstream that loses the user — a
  // refactor, a null slipping past, a job with no session — produces the key
  // "" + "/" + segments, i.e. the BUCKET ROOT: every user's data at once.
  // A blank userId must be a loud crash, never a quiet superuser.
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("vaultKey: userId is required (it must be ctx.user.id).");
  }

  // The deliberate re-parse. See the header before removing it.
  const validated = VaultPathSchema.parse([...segments]);

  return [userId, ...validated].join("/");
}

/**
 * The key of the zero-byte object that makes `segments` exist as a folder.
 *
 * WHY THIS FUNCTION EXISTS RATHER THAN A THIRD ARGUMENT TO `vaultKey`:
 * the placeholder is OUR bookkeeping, and `VaultSegmentSchema` REJECTS it as a
 * name (`VAULT_NAME_RULES.RESERVED`) precisely so a user can never mint one
 * and fabricate a phantom folder. So `vaultKey(userId, [...path, name,
 * EMPTY_FOLDER_PLACEHOLDER])` cannot work — the chokepoint correctly refuses
 * its own placeholder. The two rules are both right and they collide.
 *
 * The resolution: validate the user's segments through `vaultKey` exactly as
 * always, THEN append the placeholder — a module-level constant that never
 * touched the network — to the already-validated key. The append is safe
 * because it happens after the guard and its value is not client-supplied.
 *
 * It lives HERE, next to the schema that bans it, so that `vault-keys.ts`
 * remains the only module in the vault that constructs a storage key. The
 * adapter does no interpolation at all, which is the property that makes
 * "every key comes from the chokepoint" auditable by grep rather than by
 * trust.
 */
export function emptyFolderPlaceholderKey(
  userId: string,
  segments: readonly string[],
): string {
  return `${vaultKey(userId, segments)}/${EMPTY_FOLDER_PLACEHOLDER}`;
}

/**
 * A snapshot id is a v4 UUID, minted server-side (crypto.randomUUID) — NEVER a
 * client-supplied string. This regex is the same belt-and-braces posture as
 * `vaultKey`'s re-parse: the id already came from randomUUID, and it is still
 * validated before it is joined into a key, so a future caller that sources it
 * from somewhere untrusted cannot smuggle a separator or a traversal through
 * the one hole (the reserved-park keys) that does not pass through the segment
 * schema.
 */
const SNAPSHOT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reservedParkKey(userId: string, prefix: string, snapshotId: string): string {
  if (!SNAPSHOT_ID_RE.test(snapshotId)) {
    throw new Error("reserved park key: snapshotId must be a UUID minted server-side.");
  }
  // `vaultKey(userId, [])` runs the fail-open userId guard and yields the
  // user's own root; the reserved prefix and the validated id are appended
  // afterwards, exactly as `emptyFolderPlaceholderKey` appends the placeholder
  // — the schema bans the prefix as a NAME, so it cannot travel through the
  // segment array, and this is the one sanctioned way to build a park key.
  return `${vaultKey(userId, [])}/${prefix}/${snapshotId}`;
}

/**
 * The storage key of a prior VERSION of an object — `{userId}/.versions/<id>`.
 * The blob parked here is a copy of the object as it was before an overwrite;
 * the `file_versions` row (state=version) records which object it belongs to.
 */
export function versionSnapshotKey(userId: string, snapshotId: string): string {
  return reservedParkKey(userId, VAULT_VERSIONS_PREFIX, snapshotId);
}

/**
 * The storage key (or subtree prefix) of a TRASHED object —
 * `{userId}/.trash/<id>`. A trashed FILE parks its single blob here; a trashed
 * FOLDER parks its whole subtree UNDER here, preserving relative structure, so
 * restore is one mirrored move back. The `file_versions` row (state=trashed)
 * records the original path and the retention expiry.
 */
export function trashSnapshotKey(userId: string, snapshotId: string): string {
  return reservedParkKey(userId, VAULT_TRASH_PREFIX, snapshotId);
}

/**
 * Decode `?path=a/b` from the URL (Plans 03/04's navigation).
 *
 * A hand-edited URL is the VAULT ROOT — never an error page, never a
 * traversal. Any invalid input at all collapses to `[]`, because the honest
 * response to "I typed nonsense into the address bar" is to show the user
 * their own vault, not to argue with them.
 *
 * This is UX, never the control: the server re-validates every segment
 * regardless (T-66-12).
 */
export function parseVaultPath(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];

  const segments = raw.split("/").filter((segment) => segment.length > 0);
  const result = VaultPathSchema.safeParse(segments);

  return result.success ? result.data : [];
}
