---
phase: 77-capability-registry-mcp-server
verified: 2026-08-06T22:10:00Z
status: passed
score: "8/9 criteria verified · 1 human-gated (MCPX-09) · 0 gaps"
provenance: orchestrator-run (no per-plan PLAN.md/SUMMARY.md trail — see Provenance)
overrides_applied: 0
deferred:
  - truth: "Wave C — polytoken.addCanvasNode write tool behind POLYTOKEN_MCP_WRITE_ENABLED"
    addressed_in: "Supervised pickup (W8 in .planning/AUTONOMOUS-RUN.md deferral list)"
    evidence: "SPEC.md:217-222 gates Wave C on Phase 73 substrate + a separate default-OFF flag; the overnight-run ledger (ORCHESTRATOR-STATE.md, 'safe additive batch' block) explicitly held W8 out as security-sensitive write-exposure not to be batch-built unsupervised. No MCPX requirement covers Wave C — this is a scope boundary, not a gap. grep confirms no write tool exists: EXPOSED_TOOLS (catalogue.ts:204-250) contains only the 3 read tools and readManifestEntry throws on canvas.addNode (risk:\"write\") — catalogue.test.ts:87."
---

# Phase 77: Capability-Registry MCP Server — Verification Report

**Phase Goal:** Stand up a self-hosted, **expose-only** MCP server that projects the capability
registry's read side (`knowledge.search`, `entities.list`, `search.omnibox`) as live MCP tools over
stdio — the same owner-scoped reads the web app runs, through the same `appRouter` + `createCaller`,
scoped to a single fixed server principal, never consuming an external MCP server.
**Verified:** 2026-08-06T22:10:00Z (retroactive; ships = 2026-07-27 `d1dd3bd`, 2026-08-06 `58213cfc`/`a19aba67`)
**Status:** passed (Waves A+B; Wave C deferred-by-design; MCPX-09 human-gated)
**Re-verification:** No — initial (retroactive) verification

## Provenance — orchestrator-run, honestly stated

This phase was NOT executed through the per-plan GSD trail: the phase directory contains **only
`SPEC.md`** (no 77-0x-PLAN.md / SUMMARY.md files — confirmed by directory listing). It was built in
the grand-orchestrator sessions recorded in `.planning/ORCHESTRATOR-STATE.md`:

| Round | Ledger entry | Commit(s) | What landed |
|---|---|---|---|
| ULTRACODE ROUND 3 (2026-07-27) | "Phase 77 Waves A+B — capability-registry MCP server" | `d1dd3bd` (16 files, +2365) | New `apps/mcp-server` workspace: catalogue/principal/dispatch/handlers/index + 5 test suites + api-client schema re-exports. Adversarially verified in-round; 3 CONFIRMED findings fixed same-session (over-promising verbatim describe → authored descriptions; untested SDK entrypoint → extracted pure `handlers.ts`; wording fix). |
| Wrap-up session (2026-08-06) | "feat(77): MCP server runtime bundle + Windows test fix; daemon-protocol joins CI" | `58213cfc` | esbuild runtime bundle (`scripts/bundle.mjs` → runnable `dist/index.js`), Windows path-separator fix in the expose-only guardrail (suite now 32/32 on win32), `apps/mcp-server` + `@polytoken/daemon-protocol` added to CI. |
| Wrap-up session (2026-08-06) | "fix(73C/77): verifier findings — … esbuild pin" | `a19aba67` | esbuild `0.21.5` pinned as a direct devDependency so the runnable-dist contract stops resting on a hoisted transitive. |

All claims below are grounded in the ACTUAL code at HEAD and in gates **re-run by this verifier on
this machine today** — not trusted from the ledger.

## Goal Achievement

### Success Criteria (SPEC.md:171-197)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| MCPX-01 | `tools/list` returns exactly the expose-allowlisted tools; every listed id exists in `BUILTIN_CAPABILITY_MANIFEST` with `risk:"read"`; description drift-guarded | ✓ VERIFIED (with one documented, tested amendment — see below) | Allowlist is exactly 3 tools (`catalogue.ts:204-250`); `readManifestEntry` throws at module load on absent id or `risk!=="read"` (`catalogue.ts:128-141`) so a mis-wired tool can never list; manifest entries confirmed at source: `lookup_entity` `risk:"read"` (`builtin-manifest.ts:333,338`), `search_knowledge` `risk:"read"` (`builtin-manifest.ts:357,362`). Drift tests: exact 3-tool list, id∈manifest∧risk:read, pinned id↔tool mapping (`catalogue.test.ts:28-49,67-75`). Live `tools/list` over the built bundle returned exactly the 3 tools (reproduced today, below). |
| MCPX-02 | Each tool's `inputSchema` is the `zod-to-json-schema` conversion of a Zod input schema; a tool with no valid Zod source refused at registration | ✓ VERIFIED | `inputJsonSchema: zodToJsonSchema(toolInputSchema)` (`catalogue.ts:172,193`); `assertZodSchema` throws at registration for any non-Zod source (`catalogue.ts:111-120`), both schemas asserted per entry (`catalogue.ts:156-157,187-188`). Tests: conversion identity + refusal (`catalogue.test.ts:92-125`); the dispatch re-parse schema IS the procedure's exported schema by object identity (`catalogue.test.ts:106-117` vs `packages/api-client/src/index.ts:37-39` re-exports). Live `tools/list` shows draft-07 JSON Schema with `additionalProperties:false` per tool. Note: the PRESENTED schema is the thin `{query, limit}` one — exactly the ergonomics SPEC.md:144-146 demands; the procedure's own schema is carried separately as the MCPX-07 gate. |
| MCPX-03 | `tools/call polytoken.searchMyKnowledge` dispatches to `caller.knowledge.search` and returns the SAME items as a direct `createCaller` call | ✓ VERIFIED | `dispatchTool` invokes `caller[router][proc](parsedArgs)` via the real `createCaller` (`dispatch.ts:141-155`); parity test seeds two identical fake DBs and asserts `dispatched.data` deep-equals the direct `caller.knowledge.search(...)` result, with the node id cited in the text content (`dispatch.test.ts:76-102`), mirroring the `search.test.ts`/`knowledge-user-scoping.test.ts` pattern as SPEC required. |
| MCPX-04 | Tenancy fail-closed: no-importer principal → empty result + zero unscoped queries; identity NEVER from tool input | ✓ VERIFIED | Owner-of-no-importers → `{items: []}` with `executeCalls.count === 0` (`dispatch.test.ts:109-123` — `resolveListScope` short-circuit); smuggled `userId`/`importerId` in args are stripped by the thin schema and scope resolves for the SERVER principal only (`dispatch.test.ts:125-149`); `callerForPrincipal` threads exactly `{ user: { id: principal.id } }` into `createTRPCContext` (`handlers.ts:49-57`) and the identity-threading regression test asserts every `userOwnedImporterIds` call carries the principal id, never the smuggled one (`handlers.test.ts:95-123`). `toProcedureArgs` maps only `query`/`limit` — `importerId` is structurally unreachable from input (`catalogue.ts:218,233,248`). |
| MCPX-05 | Principal resolution fails closed: missing `POLYTOKEN_MCP_USER_ID`/`POLYTOKEN_MCP_TOKEN` refuses to start | ✓ VERIFIED (incl. live boot re-run) | `resolveServerPrincipal` throws on absent/blank either secret (`principal.ts:33-53`); resolved BEFORE any transport is wired (`index.ts:46-48`); worker-style fatal-exit discipline (`index.ts:83-86`). 5 unit tests incl. whitespace-blank (`principal.test.ts`). **Reproduced live today against the built bundle:** boot with no env → exit 1 (env validation refuses first); boot with DB env but no principal → exit 1 printing the exact `POLYTOKEN_MCP_USER_ID is required — … (fail-closed, MCPX-05)` error. Never boots with a null user. |
| MCPX-06 | Thrown `TRPCError` / bad-arg failure maps to a structured MCP error; process never crashes | ✓ VERIFIED | `dispatchTool` NEVER rejects — every failure path returns `{content, isError:true}` (`dispatch.ts:47-49,123-139,156-159`); `TRPCError` codes surface explicitly (`dispatch.ts:62-68`). Tests: `UNAUTHORIZED` (null principal) → isError content not a rejection (`dispatch.test.ts:157-169`); resolver throw caught (`dispatch.test.ts:171-187`); unknown tool name fails closed in the handler layer (`handlers.test.ts:61-69`). |
| MCPX-07 | Args re-parsed against the procedure's Zod schema at the dispatch boundary before the caller runs | ✓ VERIFIED | Two-gate parse: thin presented schema (`dispatch.ts:123`) then RE-PARSE against `procedureInputSchema` before invocation (`dispatch.ts:133-139`). Tests: `limit: 999` rejected with zero DB queries and ownership never consulted (`dispatch.test.ts:195-211`); too-short query and missing-args-object likewise rejected at the boundary (`dispatch.test.ts:213-232`). |
| MCPX-08 | Expose-only guardrail machine-checked: no MCP client/external transport, no `mcpServers` | ✓ VERIFIED (re-run 32/32 on Windows today) | `expose-only.test.ts` scans comment-stripped package source for 6 forbidden needles (client subpath, 4 client transports, `mcpServers`) (`expose-only.test.ts:50-74`), asserts the SDK is imported ONLY in `index.ts` and only its `/server/` side (`expose-only.test.ts:76-91` — the win32 `sep` normalization from `58213cfc` at line 81 is why this now passes on Windows), and asserts package.json declares no `mcpServers` and no client dep (`expose-only.test.ts:93-105`). `index.ts:27-34` imports only `server/index.js`, `server/stdio.js`, `types.js`. |
| MCPX-09 | End-to-end from Pedro's REAL Claude Code against his live graph | ⏳ HUMAN-GATED (named live seam — not a failure) | SPEC.md:193-197 itself names this as live-only, never a CI assertion. Every machine prerequisite now exists and was smoke-proven today (runnable bundle, stdio handshake, `tools/list`). Remaining is Pedro-only: the `mcpServers` entry in HIS Claude Code config + `POLYTOKEN_MCP_USER_ID`/`POLYTOKEN_MCP_TOKEN` + a live `POSTGRES_URL*` — and note the DB-password staleness from the Supabase auto-pause incident means local `.env` creds must be refreshed first. Tracked in PEDRO-CHECKLIST. |

**Score:** 8/9 criteria verified · 1 human-gated · 0 gaps

#### The one documented amendment (MCPX-01, second clause)

SPEC.md:173-175 asked for each tool description to equal the manifest `describe` **verbatim**. The
shipped code deliberately does NOT do this, and the deviation is the result of an adversarial-verify
CONFIRMED-MED finding fixed in-round (`d1dd3bd`, recorded in ORCHESTRATOR-STATE ROUND 3): the manifest
`describe` strings are written for the broader Python chat executors and **over-promise** what the
read procedures can do — `search_knowledge`'s says "Search **or expand** … Only **human-confirmed**
knowledge" (`builtin-manifest.ts:358-361`) while `knowledge.search` is trgm-only over
**EXTRACTED-tier** nodes with no graph-expand arm; `lookup_entity`'s advertises id-lookup the gallery
search lacks (`builtin-manifest.ts:334-337`). Presenting those verbatim would make a well-behaved
external agent issue calls that return nothing. The fix keeps the machine-checked half of MCPX-01
intact (id∈manifest ∧ risk:"read", enforced at load AND in tests) and authors procedure-accurate
descriptions, with a regression test guarding against the over-promise creeping back
(`catalogue.ts:159-166` rationale; `catalogue.test.ts:51-65`). Goal-backward this is a strictly more
honest catalogue than the spec's letter — recorded here as an amendment, not silently.

### Required Artifacts

| Artifact | Expected (SPEC "gap" section) | Status | Details |
|---|---|---|---|
| `apps/mcp-server/` package | Net-new workspace, `@modelcontextprotocol/sdk` the only new runtime dep, worker-style `main()` | ✓ VERIFIED | `package.json` — private workspace `@polytoken/mcp-server`, SDK `^1.12.0`, `start: node dist/index.js`; `index.ts:46-86` mirrors `apps/worker`'s required-env-or-throw + fatal-exit `main()`. |
| Catalogue projection (`catalogue.ts`) | Explicit expose-allowlist, NOT "everything read"; thin query-first inputs; drift-guarded | ✓ VERIFIED | Exactly 3 entries, frozen (`catalogue.ts:204-250`); thin `{query, limit}` schemas whose bounds mirror the procedures' own Zod maxima (limit ≤50/≤100/≤20, `catalogue.ts:92-105` — the SPEC's result-size landmine); `importerId`/`offset`/`sort` server-defaulted. |
| Principal seam (`principal.ts`) | Fixed server-verified principal from env, fail-closed, never from tool input | ✓ VERIFIED | See MCPX-04/05 rows. |
| Dispatch bridge (`dispatch.ts` + `handlers.ts`) | tools/call → re-parse → `createCaller(ctx)` → MCP content; TRPCError → MCP error | ✓ VERIFIED | See MCPX-03/06/07 rows; cited text content via `formatCitedResult` (`dispatch.ts:75-110` — every row carries `[id: …]`). |
| Expose-only guardrail test | Machine-checks "never consume external MCP" | ✓ VERIFIED | See MCPX-08 row. |
| Runtime bundle (`scripts/bundle.mjs` → `dist/index.js`) | `node apps/mcp-server/dist/index.js` boots from a plain checkout | ✓ VERIFIED (self-run) | esbuild single-file ESM bundle, workspace TS inlined, only `pg`/`pg-native`/`postgres` external, esbuild `0.21.5` pinned as direct devDep (`a19aba67`); `dist/index.js` present (4.3 MB, built today). Stdio smoke reproduced below. |
| CI coverage | mcp-server in the TS matrix | ✓ VERIFIED | `.github/workflows/ci-web-and-packages.yml` — `apps/mcp-server/**` in both path filters (:14, :25); `@polytoken/mcp-server` in the typecheck loop (:75) and the test loop (:95). Same commit also added `@polytoken/daemon-protocol` to both loops (:69, :89). |

### Adversarial Spot-Checks (self-run today, not trusted from the ledger)

| Check | Method | Result |
|---|---|---|
| Full mcp-server suite on Windows | `npm run test -w @polytoken/mcp-server` from the working tree | **5 files / 32 tests, all green** (principal 5, expose-only 4, catalogue 10, handlers 5, dispatch 8) — independently confirms the `58213cfc` claim that the win32 `sep` fix took the suite to 32/32 on this exact platform. |
| Fail-closed boot, no env | `node apps/mcp-server/dist/index.js < /dev/null` | exit 1 — refuses at env validation (`POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` required) before anything is wired. |
| Fail-closed boot, no principal (MCPX-05 live) | Same, with dummy `POSTGRES_URL*` set but no `POLYTOKEN_MCP_*` | exit 1 printing the exact catalogue error: `POLYTOKEN_MCP_USER_ID is required — the expose-only MCP server refuses to start without a fixed server principal (fail-closed, MCPX-05)`. |
| Stdio smoke (bundle boots + tools/list) | Piped a JSON-RPC `initialize` → `notifications/initialized` → `tools/list` sequence into the bundle with dummy DB env + a dummy principal | Handshake answered (`serverInfo: {name:"polytoken", version:"0.1.0"}`); `tools/list` returned **exactly** `polytoken.searchMyKnowledge`, `polytoken.listEntities`, `polytoken.searchEverything`, each with its authored description and a draft-07 JSON Schema (`query` required, `limit` bounded 50/100/20, `additionalProperties:false`). Exit 0. This reproduces the `58213cfc` "dist boots via stdio smoke" claim first-hand. |
| No write tool reachable | Read `EXPOSED_TOOLS` end-to-end + `catalogue.test.ts:84-89` | Only the 3 read tools exist; `readManifestEntry("canvas.addNode")` throws `/risk="write"/` — the Wave C surface is provably absent, matching the W8 deferral. |
| Provenance trail honest | Directory listing of `.planning/phases/77-capability-registry-mcp-server/` + `git log --all -- apps/mcp-server` | Only `SPEC.md` (+ this file) exists — no PLAN/SUMMARY trail, consistent with orchestrator-run provenance. Package history is exactly `d1dd3bd` → `58213cfc` → `a19aba67`. |

### Regression / Gate Status (integration-time, per the wrap-up session)

Gates recorded at integration (worker 34 · **mcp 32/32** · web 461 targeted + typecheck · drizzle
check · api-client 59 entities · listener targeted + mypy 318 + lint-imports), with the FULL listener
pytest + full TS matrix running at write time — per the orchestrator's instruction these are assumed
green unless the ledger notes otherwise. The **mcp-server 32/32** figure was NOT assumed: it was
re-run and confirmed by this verifier (above), as were both boot-refusal paths and the stdio smoke.

### Requirements Coverage

| Requirement | Status | Where |
|---|---|---|
| MCPX-01..08 | ✓ SATISFIED (MCPX-01 with the documented describe amendment) | Table above; all in `apps/mcp-server/src/` + its 5 test suites |
| MCPX-09 | ⏳ HUMAN-GATED | Pedro's real Claude Code + refreshed DB creds; all machine prereqs shipped and smoke-proven |
| Wave C (SPEC build sketch, no MCPX id) | DEFERRED-BY-DESIGN | W8 supervised pickup; frontmatter `deferred` entry |

### Anti-Patterns Found

None blocking. Scanned all 5 source files + 5 test files: no TODO/FIXME/placeholder stubs. One
honest wart, disclosed not hidden: `index.ts:64-77` casts the pure handler results to the SDK's
`ListToolsResult`/`CallToolResult` at the SDK boundary (documented in-line as adapting to the SDK's
newer task-augmented result union); the shapes themselves are structurally asserted by
`handlers.test.ts`, so the cast is cosmetic, not a coverage hole.

### Human Verification Required (named live seams — Pedro-gated)

| Seam | What it needs | Why it can't be gated here |
|---|---|---|
| **MCPX-09** live connect | `mcpServers` entry in Pedro's own Claude Code config + real `POLYTOKEN_MCP_USER_ID`/`POLYTOKEN_MCP_TOKEN` + live `POSTGRES_URL*` (stale since the Supabase auto-pause password change — refresh first) | SPEC.md:193-197 names it live-only: "verify against the DB, not terminal output"; a real external agent session cannot run in CI |
| Real-data grounding pass | One `polytoken.searchMyKnowledge` call returning cited nodes from Pedro's live graph | Same seam; needs real owned importers |

### Gaps Summary

None. All 8 gate-able criteria are verified against the actual code with file:line evidence, the
critical gates were re-run (not trusted) on this machine — 32/32 tests, both fail-closed boot paths,
and a full stdio `tools/list` smoke against the shipped bundle — and the single deviation from the
SPEC's letter (MCPX-01's verbatim-describe clause) is a same-session, adversarially-motivated,
regression-tested amendment that makes the catalogue MORE honest, recorded openly above. MCPX-09 is
the phase's one named live seam (human-gated by design, not a failure), and the Wave C write tool is
a deliberate, machine-provably-absent deferral awaiting supervised work.

---

*Verified: 2026-08-06T22:10:00Z*
*Verifier: Claude (retroactive gsd-verifier, orchestrator wrap-up session)*
