---
phase: 66-files-vault
plan: 02
subsystem: vault-api
tags: [trpc, tenancy, storage, supabase]
requires: ["66-01"]
provides:
  - "filesRouter / createFilesRouter — list, createFolder, requestUpload, requestDownload, remove"
  - "createServiceRoleVaultClient / VAULT_BUCKET"
  - "vaultApi / VaultApiProvider — the D-66-03 seam"
affects: ["66-03", "66-04"]
tech-stack:
  added: []
  patterns: ["injected-adapter router factory", "type-only cross-package router composition"]
key-files:
  created:
    - packages/api-client/src/router/files/index.ts
    - packages/api-client/src/router/files/service-client.ts
    - packages/api-client/src/router/files/__tests__/files-tenancy.test.ts
    - packages/api-client/src/router/files/__tests__/files-inputs.test.ts
    - apps/web/src/app/files/_lib/vault-api.tsx
  modified: []
decisions: [D-66-02, D-66-03, D-66-13]
metrics:
  tasks: 3
  tests-added: 26
  files-suite: "94 passed"
  completed: 2026-07-17
---

# Phase 66 Plan 02: Vault API Summary

Five protected procedures over Plan 01's spine, the one place Supabase is constructed, and a
type-only seam that lets the surface call `files.*` and typecheck today — with `root.ts` untouched.

## What shipped

| Artifact | Provides |
|---|---|
| `router/files/index.ts` | `filesRouter`, `createFilesRouter({ adapter })` — five procedures, all protected |
| `router/files/service-client.ts` | `createServiceRoleVaultClient`, `VAULT_BUCKET` — the ONE supabase-js import site |
| `__tests__/files-tenancy.test.ts` | The behavioural proof — 21 tests |
| `__tests__/files-inputs.test.ts` | The source-level gate — 5 tests |
| `files/_lib/vault-api.tsx` | `vaultApi`, `VaultApiProvider` (D-66-03) |

Commits: `ae9465f` (router + service client), `4e144b8` (proofs), `2231c6b` (tsc fix), `e5b6438` (seam).

## ⚠ Orchestrator requests — verbatim

**1. `packages/api-client/src/root.ts` — add one line, nothing else:**

```ts
import { filesRouter } from "./router/files";
// ...
export const appRouter = createTRPCRouter({
  emails: emailsRouter, entityTypes: entityTypesRouter, entities: entitiesRouter,
  knowledge: knowledgeRouter, genui: genuiRouter, chat: chatRouter,
  forwarding: forwardingRouter,
  files: filesRouter,          // ← this
});
```

**2. `packages/api-client/package.json` — add `@supabase/supabase-js` to `dependencies`.**
**Entry only.** It is already in the root lockfile via `apps/web` (verified hoisted at
`node_modules/@supabase/supabase-js`), so no new third-party code enters the tree and in-worktree
`tsc` resolves it today. The entry is hygiene — the package now genuinely imports it (D-66-02).

**3. Post-merge cleanup (non-blocking).** Delete `apps/web/src/app/files/_lib/vault-api.tsx`,
find-replace `vaultApi` → `api` from `~/trpc/react`, and drop `<VaultApiProvider>` from
`files/page.tsx` (the app-wide `TRPCReactProvider` covers it). The file's header carries this
contract so it does not become a permanent second client nobody dares delete.

## Negative proofs — all three red, all three restored

| # | Sabotage | Result |
|---|---|---|
| 1 | `list` takes the userId from input (`input.userId ?? ctx.user.id`) | **RED — 2 failed / 92 passed** |
| 2 | ONE procedure (`remove`) swapped to `publicProcedure` | **RED — 3 failed / 91 passed** |
| 3 | The `VaultStorageError` catch returns `[]` | **RED — 2 failed / 92 passed** |

**Proof 2's requirement was that BOTH gates fire independently — verified by name, not assumed:**

```
FAIL files-inputs.test.ts  > every procedure takes its acting user from the auth context
FAIL files-inputs.test.ts  > no procedure under router/files is public
FAIL files-tenancy.test.ts > a signed-out caller reaches nothing > remove -> UNAUTHORIZED
```

The source gate is the one that survives a refactor; the behavioural gate is the one that catches
wiring. They fail on different mistakes, which is why both exist.

## D-66-13 (new) — the seam's router imports MUST be type-only

**The plan's snippet had a security bug.** It imports `createTRPCRouter` as a **value**:

```tsx
import { createTRPCRouter } from "../../../../../../packages/api-client/src/trpc";  // ← plan's snippet
```

`packages/api-client/src/trpc.ts` imports `db` from `@polytoken/db/client`. A value import from a
`"use client"` module would therefore pull **the database client and its connection string into the
browser bundle**. Shipped as `import type` on both router imports — erased at compile, so this
file's runtime import graph is exactly `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`,
`superjson`, and nothing from the server package. The header states this is load-bearing rather than
style, because it reads like a lint preference and is not one.

`typeof createTRPCRouter` still works in type position under `import type`, so the plan's preferred
inline generic needed no fallback.

## The seam is a real type, not `any` — probed, not assumed

A cast would defeat the seam entirely: it would let a mismatched procedure shape reach main and fail
only at runtime, on the user's machine. So the type was probed in both directions:

- **Positive:** `vaultApi.files.list.useQuery({ path: ["a"] })` typechecks and `data` flows through
  as `VaultEntry[]` with real `.name` / `.kind`.
- **Negative:** a typo'd input key (`pathTypo`), an unknown procedure, and a wrong segment type
  (`path: [123]`) are each rejected by `tsc`. Zero `as any`, zero `@ts-expect-error`.

## Deviations from plan

1. **[Rule 2 — Security] Both seam router imports made type-only.** See D-66-13. The plan's snippet
   would have bundled the DB client into the browser.
2. **[Rule 1 — Bug] Rejection assertions are on the tRPC error CODE, not the message.** The plan's
   phrasing ("reject with BAD_REQUEST") read naturally as a message match, and my first draft wrote
   it that way — 4 tests went red. When zod rejects an input, tRPC throws a `TRPCError` whose `code`
   is `BAD_REQUEST` but whose `message` is the serialized zod issue list. A message match would
   assert on the shape of zod's JSON and rot on a zod upgrade. The code IS the contract.
3. **[Rule 1 — Bug] `toSatisfy`'s predicate param typed `unknown`, not `Error`.** `tsc` caught it
   after the commit. A thrown value genuinely can be anything; typing it `Error` is a claim about a
   shape nobody checked. Fixed in `2231c6b` — recorded rather than amended into the prior commit,
   because the bar is a clean `tsc` and the honest record is that it briefly was not.
4. **[Rule 3 — Blocking, carried from Plan 01]** All verification used `npx vitest run --root <pkg>`
   / `npx tsc --noEmit -p <pkg>` rather than the plans' `npm run … -w <pkg>`, which mutates
   `package-lock.json` (orchestrator-reserved).

## Threat register status

| Threat | Disposition | Proven by |
|---|---|---|
| T-66-02 (elevation) | mitigated | impersonation tests (5) + the source gate — two independent gates, both verified to fire |
| T-66-03 (info disclosure) | mitigated | `requestDownload` returns `{ url }` only; 60s expiry + attachment disposition from Plan 01 |
| T-66-04 (spoofing) | mitigated | five written-out UNAUTHORIZED cases + the `publicProcedure` source ban |
| T-66-05 (DoS) | mitigated | `size.max(VAULT_MAX_UPLOAD_BYTES)` server-side; over-cap request rejected with the adapter never called |
| T-66-07 (info disclosure) | mitigated | storage-failure test asserts the client message contains no key, bucket, or internal text |
| T-66-10 (repudiation) | **accept** | No audit log tonight. Single-user self-cloud; storage keeps `created_at`/`updated_at`. **Not optional if the vault ever gains sharing.** |

## Boundary

`git status --short` shows changes only under `packages/api-client/src/router/files/` and
`apps/web/src/app/files/`. **`root.ts`, `index.ts`'s exports map, and every `package.json` and
lockfile are untouched** — checked before each commit, not discovered at merge.

## Self-Check: PASSED

All five files exist; commits `ae9465f`, `4e144b8`, `2231c6b`, `e5b6438` are in `git log`;
`npx tsc --noEmit -p packages/api-client` and `-p apps/web` both clean; 94/94 files-router tests
green; full api-client suite 510/510.
