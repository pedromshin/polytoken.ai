---
phase: 66-files-vault
plan: 01
subsystem: vault-core
tags: [storage, tenancy, security, supabase-storage]
requires: []
provides:
  - "vaultKey/parseVaultPath/VaultSegmentSchema/VaultPathSchema/VaultNameSchema/EMPTY_FOLDER_PLACEHOLDER/emptyFolderPlaceholderKey"
  - "VaultEntry/VaultKind/VaultStorageClient/RawFileObject"
  - "createVaultAdapter/VaultAdapter/VaultStorageError/VAULT_MAX_UPLOAD_BYTES"
affects: ["66-02", "66-03", "66-04"]
tech-stack:
  added: []
  patterns: ["structural injected client seam", "chokepoint key construction", "message-level schema assertions"]
key-files:
  created:
    - packages/api-client/src/router/files/vault-types.ts
    - packages/api-client/src/router/files/vault-keys.ts
    - packages/api-client/src/router/files/storage-adapter.ts
    - packages/api-client/src/router/files/__tests__/vault-keys.test.ts
    - packages/api-client/src/router/files/__tests__/storage-adapter.test.ts
    - .planning/phases/66-files-vault/SCHEMA-REQUEST.md
  modified: []
decisions: [D-66-01, D-66-04, D-66-07, D-66-12]
metrics:
  tasks: 3
  tests-added: 68
  package-suite: "510 passed (38 files)"
  completed: 2026-07-17
---

# Phase 66 Plan 01: Vault Core Summary

The vault's spine: one function builds every storage key and re-validates its own inputs, one
adapter reaches storage through an injected seam, and 68 tests — two of them negative proofs —
make the tenancy guarantee something other than a claim in a comment.

## What shipped

| Artifact | Provides |
|---|---|
| `vault-keys.ts` | `vaultKey`, `parseVaultPath`, the segment/path/name schemas, `EMPTY_FOLDER_PLACEHOLDER`, `emptyFolderPlaceholderKey` |
| `vault-types.ts` | `VaultEntry`, `VaultKind`, `VaultStorageClient`, `RawFileObject` — types only, zero runtime, zero supabase import |
| `storage-adapter.ts` | `createVaultAdapter` (list / signed download / signed upload / mkdir / recursive remove), `VaultStorageError`, `VAULT_MAX_UPLOAD_BYTES` |
| `SCHEMA-REQUEST.md` | Bucket `user-files`, **zero tables** |

Commits: `e6d5c94` (chokepoint), `30cdf90` (adapter), `e583f76` (schema request).

## `VaultEntry` as shipped — unchanged from the plan's §C

Plan 03 imports this type-only. **It did not drift**:

```ts
export type VaultKind = "folder" | "text" | "image" | "archive" | "audio" | "video" | "file";
export type VaultEntry = {
  readonly name: string;
  readonly kind: VaultKind;
  readonly isFolder: boolean;
  readonly size: number | null;
  readonly updatedAt: string | null;
  readonly contentType: string | null;
};
```

## Negative proofs — all five went red, all five restored

Task 1 (`vault-keys`), both required by the plan:

| # | Sabotage | Result |
|---|---|---|
| 1 | Deleted the `..`/`.` refine from `VaultSegmentSchema` | **RED — 2 failed / 33 passed.** The two dot-segment cases. |
| 2 | Replaced `vaultKey`'s re-parse with a bare `[userId, ...segments].join("/")` | **RED — 2 failed / 33 passed.** |

Task 2 (`storage-adapter`), all three required by the plan:

| # | Sabotage | Result |
|---|---|---|
| 1 | `listFolder` swallows the error branch (`return []`) | **RED — 1 failed / 32 passed.** |
| 2 | Folder walk made non-recursive (first level only) | **RED — 2 failed / 31 passed** (recursive + tenancy). |
| 3 | Dropped `{ download: filename }` from `signedDownloadUrl` | **RED — 1 failed / 32 passed.** |

All restored; 68/68 green, full package 510/510.

### The finding inside negative proof 1 — worth reading

Deleting the traversal guard left **the tenancy test green**. `".."` is caught by the
trailing-period rule as well, so a test asserting only `success === false` would have passed with
the guard gone. Only the two cases that assert on the **issue message** went red.

The rules overlap, so "it was rejected" is a much weaker claim than it looks. Every rejection case
in `vault-keys.test.ts` therefore asserts *which rule fired* — that is what makes each refine
independently load-bearing, and it is the difference between a proof and 35 tests that feel
thorough. Recorded because the same trap applies to any multi-rule validator anyone writes next.

## D-66-12 (new) — `createFolder` could not be built as specified

**The plan's instruction was impossible, and the test caught it.** Plan 01 specified:

```ts
vaultKey(userId, [...segments, name, EMPTY_FOLDER_PLACEHOLDER])   // ← throws
```

while the *same plan* requires `VaultSegmentSchema` reject `EMPTY_FOLDER_PLACEHOLDER`
(`VAULT_NAME_RULES.RESERVED`) — so the chokepoint correctly refuses its own placeholder. Both rules
are right; they collide.

**Resolved** with `emptyFolderPlaceholderKey(userId, segments)` in `vault-keys.ts`: the user's
segments still cross `vaultKey` exactly as always, and only our own module-level constant is
appended to the already-validated key. It lives next to the schema that bans it so that
`vault-keys.ts` stays the **only** module in the vault that constructs a key — the adapter does no
path-building from its arguments at all, which keeps "every key comes from the chokepoint"
auditable by grep rather than by trust.

## The one honest caveat in the adapter

`collectKeysUnder` (the folder-delete walk) builds child keys as `` `${prefix}/${entry.name}` ``.
That is interpolation, and the module header would otherwise have been overclaiming, so it now
names this exception explicitly: the `prefix` is an already-validated key and `entry.name` is a
basename **returned by storage**, not by a caller — descent through a tree we already proved we are
inside of, not construction from an input. The tenancy test pins the consequence directly rather
than trusting the paragraph: no key handed to `remove` ever leaves `{userId}/`, proven against a
fake simultaneously holding user-b's mirror-named objects.

## Deviations from plan

1. **[Rule 1 — Bug] `createFolder`'s specified key construction was impossible.** See D-66-12
   above. Caught by the test, not by review.
2. **[Rule 3 — Blocking] `npm run test -w <pkg>` mutates `package-lock.json`.** The plan's verify
   commands use it; npm pruned 590 lines of `extraneous` entries from the lockfile as a side
   effect. **`package.json`/lockfile changes are orchestrator-reserved** (LANE-CONTRACTS), so this
   was reverted immediately (`git checkout -- package-lock.json`) and every subsequent run used
   `npx vitest run --root <pkg>` / `npx tsc --noEmit -p <pkg>`, which are verified not to touch it.
   **The other lanes are hitting this too if they used the plans' commands verbatim — worth a
   check at merge.**
3. **[Rule 1 — Bug] Raw control bytes were written into source.** The first draft of
   `vault-keys.test.ts` and `vault-keys.ts` contained literal NUL/DEL bytes rather than escapes
   (invisible in review, mangled by the next formatter). Replaced with `\uXXXX` escapes; both files
   verified to contain zero raw control characters.
4. **[Rule 1 — Bug] A zero-width non-joiner (U+200C) landed in `SCHEMA-REQUEST.md`.** Caught by the
   injection-detection hook. Stripped, and every file this lane has written was swept — all clean.

## Threat register status

| Threat | Disposition | Where it is proven |
|---|---|---|
| T-66-01 (traversal) | mitigated | `vault-keys.test.ts` — message-level, negative proof 1 |
| T-66-02 (elevation) | mitigated | adapter takes `(userId, segments)`, never a key; grep confirms the chokepoint is its only key source |
| T-66-05 (DoS) | mitigated | listing cap 500 asserted from the fake's received args; depth cap 32; `VAULT_MAX_UPLOAD_BYTES` defined once |
| T-66-09 (destructive) | mitigated | the tenancy proof on the folder walk + visited-prefix cycle guard |
| T-66-SC (supply chain) | **accept** | **Zero new packages.** The Package Legitimacy Gate has nothing to audit. |

## deps: for the orchestrator

- `packages/api-client/package.json` — add `@supabase/supabase-js`. **Entry only**: it is already in
  the root lockfile via `apps/web` (verified hoisted at `node_modules/@supabase/supabase-js`), so no
  new third-party code enters the tree and in-worktree `tsc` resolves it today. *Plan 02 is what
  actually imports it; this lane never edits the manifest.*

## Self-Check: PASSED

All six files exist on disk; all three commits (`e6d5c94`, `30cdf90`, `e583f76`) are in
`git log`; `npx tsc --noEmit -p packages/api-client` clean; 510/510 package tests green;
`git status --short` shows nothing outside this lane's owned paths.
