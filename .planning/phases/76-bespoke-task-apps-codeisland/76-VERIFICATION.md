---
phase: 76-bespoke-task-apps-codeisland
verified: 2026-08-06
status: passed
score: 9/10 requirements verified · 1 human-gated (BTAP-07) · 0 gaps
provenance: retroactive; orchestrator-run (no per-plan PLAN.md trails — evidence is ORCHESTRATOR-STATE.md rounds + git SHAs + direct code inspection)
human_gated:
  - id: BTAP-07
    seam: "agent-authored summon loop, live browser + running listener + flag flip"
    note: "code shipped and flag-gated (353839d0 listener + de8137ec web); the live one-turn loop is a named Pedro-gated seam, not a failure"
notes:
  - "prod codeIslands.create is currently DEGRADED by the prod DB password outage (Supabase auto-pause recovery changed passwords; Vercel env stale) — a live-ops incident, not a Phase 76 code defect"
  - "BTAP-03's SPEC-named vitest (panel-data-flow extension) was never written — mechanism verified at code level; rolled into the owed real-browser pass"
---

# Phase 76: Bespoke Task Apps (code-islands over your data) — Verification Report

**Phase Goal:** Weld the shipped Phase-20 jailed code-island generator to the Phase-73 reactive
dataflow spine: select ≥2 data nodes, say "build me a reconciler," and the agent generates a real,
persisted, disposable mini-app as a canvas node — sandboxed JS consuming the user's actual rows as
typed inputs, recomputing when a source cell changes, network-exfiltration impossible.
**Verified:** 2026-08-06 (retroactive, wrap-up session — all commits local on `main`, about to push)
**Verifier method:** goal-backward — every SPEC success criterion checked against the ACTUAL code
(Grep/Read, file:line), the named commits, and the orchestrator ledger. Nothing trusted from
session summaries without an independent code read.

## Provenance (honest accounting)

This phase ran under the **grand-orchestrator ledger model**, not the per-plan GSD trail: there are
no `76-0N-PLAN.md` files. The build history lives in `.planning/ORCHESTRATOR-STATE.md`:

| Round (ledger block) | Date | What shipped | SHAs |
|---|---|---|---|
| Wave A (76-01 sandbox data channel) | 2026-07-26 | `buildIslandSrcdoc({data})` → frozen `__ISLAND_DATA__`, CSP/sandbox byte-pinned | `7866c108` |
| Wave B (76-03 node + persistence) | 2026-07-26 | `code_islands` table (0055) + `codeIslands.*` router + `code-island` node type + `code-island-node.tsx` | `b64c56c3` |
| Summon loop (76-02a/76-04/76-04b/76-04c) | 2026-07-26 | publish-port prereq, api-client `inputs` passthrough, "Build a tool from these" flow + intent dialog + "Your tools" picker; **0055 applied to PROD same day** (Management API, verified against the DB: RLS on, drizzle bookkept id 53) | summon-loop session commits incl. `9e309328` |
| Ultracode round 3 (76-05) | 2026-07-27 | `emit_code_island` agent tool (flag-gated, fail-closed) + web `canvas_code_island` reconcile | `353839d0` (listener), `de8137ec` (web) |
| Overnight W3 (provenance) | 2026-07-27 | migration **0059** `code_islands.provenance` + unique `(user_id, provenance)` + create UPSERT; first codeIslands router test | PR #11, guard `677fa26b` |
| Wrap-up (76-02b) | 2026-08-06 | listener CONSUMES the typed-inputs manifest in the generator prompt + hardening | `87f4daf5`, `08c336a7` |
| Branch close | 2026-08-06 | merge of `claude/phase-76-summon-loop-al5emg` (migrate workflow secrets-only + rotation docs) | `985e2071` |

Every 2026-08-06 stream was adversarially verified; CONFIRMED findings fixed same-session
(ledger: "vNEXT CODE-COMPLETE" block). Gates at integration: worker 34 · mcp-server 32/32 ·
web 461 targeted + tsc · drizzle-kit check · api-client 59 (entities) · listener targeted suites +
mypy 318 + lint-imports. FULL listener pytest + full TS matrix were still running at ledger time —
assumed green per the ledger's own note (no contrary note recorded).

## Goal Achievement — SPEC Success Criteria

| # | Criterion | Status | Evidence (file:line, self-read) |
|---|-----------|--------|--------------------------------|
| BTAP-01 | Sandbox data channel: frozen `window.__ISLAND_DATA__` via JSON string (never eval), before user code; pollution/oversize rejected; CSP + sandbox byte-unchanged | ✓ VERIFIED | `packages/genui/src/sandbox/build-island-srcdoc.ts:105` `serializeIslandData` (rejects pollution keys / oversize / unserializable), `:159-160` `window.__ISLAND_DATA__` installed via `JSON.parse` of an inert string with a `{}` fallback, `:217` data gated through `serializeIslandData` before the builder emits. Drift-guard tests: `build-island-srcdoc.test.ts:87-92` pins `ISLAND_SANDBOX === "allow-scripts"` and `ISLAND_CSP_POLICY` **byte-for-byte** (connect-src 'none' preserved), `:109-136` pollution (`constructor`/`prototype`) + bigint + cyclic + oversize all rejected, `:143-160` injection is `JSON.parse`-not-eval and precedes the user script, `:165` no data ⇒ no global. Commit `7866c108`. |
| BTAP-02 | `code-island` node type in BOTH allowlists, ref-only `.strict()` `{islandId, label?}`, drift test green | ✓ VERIFIED | `packages/capabilities/src/canvas.ts:260-266` — `"code-island": z.object({ islandId: z.string().uuid(), label: ... }).strict()` with the ref-only rationale in-comment; `CANVAS_NODE_TYPE_IDS` frozen at `:271-273`. Web side: `node-type-registry.test.ts:59` covers `code-island` explicitly; `canvas-capability-mirror.test.ts:116-125` safeParses every web node.data fixture against `CANVAS_NODE_DATA_SCHEMAS` (id-set drift pinned). Commit `b64c56c3`. |
| BTAP-03 | Node collects overlaid inputs from `usePanelData`, passes `{targetKey: projection}` into the sandbox; source change re-renders island, `code` prop stable | ✓ VERIFIED (mechanism; see test-debt note) | `apps/web/src/app/chat/_canvas/code-island-node.tsx:74` `usePanelData(id, incomingEdges)`, `:76` `api.codeIslands.byId.useQuery` (never re-generates on mount), `:168` `<CodeIslandFrame code={island.code} data={panelData} />`. Reactive leg: `apps/web/src/app/studio/_components/code-island-frame.tsx:107-119` — `dataSignature` (stable JSON of `data`) joins the nonce key, so a data change forces a fresh frame **without** touching `state.code`/the repair pipeline; `:180-181` rebuilds srcdoc with `data`. **Honest caveat:** the SPEC-named vitest (extend `panel-data-flow.test.tsx` asserting code-stable-while-data-changes) was never written — `panel-data-flow.test.tsx` has zero island coverage. The overlay machinery itself is the unchanged, already-tested `usePanelData`; the injection ordering is covered by the genui tests above. Residual test debt, rolled into the owed real-browser pass. |
| BTAP-04 | `code_islands` round-trips: create → byId returns `{intent, code, inputBindings}` for owner; non-owner byId = NOT_FOUND before any read | ✓ VERIFIED | Table: `packages/db/migrations/0055_code_islands.sql` (FK→auth.users cascade, user_id index, **ENABLE ROW LEVEL SECURITY** + owner policy per the brand-new-table idiom) — **applied to PROD 2026-07-26**, verified against the DB per ledger (rls_enabled=true, drizzle bookkept). Router: `packages/api-client/src/router/code-islands/index.ts:91-96` byId asserts `assertCodeIslandOwnership` via `assertOwnedOrNotFound` BEFORE the select (`:97-108` returns intent/code/inputBindings); `:118-188` create stamps owner server-side. Router test: `code-islands/code-islands.test.ts` (added in the overnight W3 round — previously the last untested router). Provenance upsert: migration `0059` (`provenance` column + unique `(user_id, provenance)`), `index.ts:142-179` feature-detects the column (`tableColumnExists`, the 0036 pattern — migration-order-safe, guard commit `677fa26b`) then UPSERTs on conflict so an agent re-run can't orphan a row; NULL provenance (user summon) never conflicts. |
| BTAP-05 | Bounded `inputs` manifest accepted, forwarded to FastAPI, size/shape-capped; omitting it preserves intent-only behaviour exactly | ✓ VERIFIED | **76-02a (web):** `packages/api-client/src/router/genui/code-island.ts:48-106` `CodeIslandInputsManifest` (≤32 keys `:90`, shape only), `:140-143` forwarded as `inputs: input.inputs ?? null` (additive; back-compat null). **76-02b (listener, `87f4daf5`):** `apps/email-listener/app/presentation/api/v1/genui_code.py:41-47` mirrors the web zod caps, `:106-125` optional `inputs` field + key validation, `:167-179` forwards plain dicts; `generate_code_island.py:105-159` threads `inputs` to the adapter; `genui_code_generator_adapter.py:319-327` injects the manifest as an `<INPUTS_SECTION>` **in the USER turn only** (system prompt stays byte-static for the D-21 cache; `None`/empty ⇒ suffix `""` = today's behaviour exactly). **Hardening (`08c336a7`):** `:326` every literal `<` in the manifest JSON is replaced with its unicode escape (`json.dumps(...).replace("<", "\\u003c")`) so no manifest string can close `</INPUTS_SECTION>` (delimiter-breakout / prompt-injection escape closed); `genui_code.py:76-82` rejects `bool` posing as `rowCount` (bool-is-int-subclass trap). 3 test files extended in `87f4daf5` (+41/+94/+117 lines: use-case, adapter, endpoint). |
| BTAP-06 | "Build a tool" flow: ≥2 selected published sources → exactly ONE code-island node + one data-edge per source, no duplicate node/edges | ✓ VERIFIED | Pure core: `apps/web/src/app/chat/_canvas/build-tool-flow.ts:175-211` `collectToolInputs` — keeps only selected sources with a live `shared.published` projection, unique JS-ident targetKeys, emits parallel `inputs` (shape → generator) + `inputBindings` (wiring → persistence). Orchestration: `chat-canvas.tsx:1053-1167` `handleBuildTool` — one-shot imperative `codeIslandGenerate.fetch` → `codeIslands.create` → ONE node (`:1133-1136`) + one edge per source, **single history/save unit** (one `scheduleSave`, `:1167`); in-flight guard `:1076` (`isBuildingTool` — one summon at a time). **Semantics note (honest):** a deliberate re-summon of the same selection mints a DISTINCT tool (fresh uuids) rather than no-op'ing — the ledger-documented reading of "idempotent" for a non-deterministic generator (no duplicate of the SAME island, no half-materialized state); strict same-artifact idempotency exists on the agent path via the 0059 provenance upsert. Tests: `build-tool-flow.test.ts` (11: sanitize/collision/skip-unpublished/exclude-chat-singleton-and-islands/distinct-keys/intent), `add-node-menu.test.tsx` (+summon eligibility cases), `build-tool-dialog` (5), `code-island-picker-dialog` (4). |
| BTAP-07 | Agent-authored: chat "build me a reconciler" → `emit_code_island` (behind `CANVAS_EMIT_TOOL_ENABLED`, fails closed) → wired node live in one turn | ⏳ HUMAN-GATED (code shipped + verified; live loop owed) | Listener (`353839d0`): `app/infrastructure/llm/chat_tools.py:85` `EMIT_CODE_ISLAND_TOOL_NAME`, `:561` `build_emit_code_island_tool` (Bedrock root-object + additionalProperties:false asserted `:554-557`); registered ONLY when `settings.CANVAS_EMIT_TOOL_ENABLED` (`app/composition/chat_turn_providers.py:314-324`, structural omission = fail-closed, byte-identical off); part assembly + manifest cleaning in `run_chat_turn_tool_loop.py:312` `_clean_inputs_manifest` / `:350`. Web (`de8137ec`): `agent-code-island-reconcile.ts` re-grounds against the live canvas (values never reach the model), keyed on part provenance `agent-island:{messageId}:{partIndex}` (`:22`, `:77`); chat-canvas materializes via the SAME grounding flow (`chat-canvas.tsx:1253-1256`); the 2026-07-27 verify pass caught + fixed the publish-race (publish-signature dep) and the re-mint orphan (closed by the 0059 upsert). **The live seam:** running listener + `:3000` web + DB + `CANVAS_EMIT_TOOL_ENABLED` flip + real-browser observation — named Pedro-gated (ledger REMAINING list). Not a failure; the flag ships dark by design. |
| BTAP-08 | Safety stack intact with data present: validateIslandCode still gates; fetch/XHR/eval/parent BLOCKED; frame opaque-origin, connect-src 'none' | ✓ VERIFIED | `validate-island-code.test.ts:30-34` — a data-reading island (`window.__ISLAND_DATA__.invoices`) passes the allowlist UNCHANGED (the point of the channel), alongside the pre-existing adversarial fixtures (NETWORK/DYNAMIC_EVAL/STORAGE/HOST_ACCESS/REFLECTION forbidden sets, `validate-island-code.ts:55-59`, reflective props `:74`). `build-island-srcdoc.test.ts:91-107` — with data present the emitted HTML still contains the byte-pinned CSP and **no** `unsafe-eval` (`:105`); `:24-25` unsafe-eval drift guard; `:150` no bare `eval(` in the injected harness. `ISLAND_SANDBOX` still `"allow-scripts"` only (`build-island-srcdoc.ts:18`) — no allow-same-origin, opaque origin preserved. The data channel opens no new sink: data enters as a JSON string parsed inside the jail. |
| BTAP-09 | Tenancy: every `codeIslands.*` proc `protectedProcedure`, ownership asserted FIRST; generation cache posture unchanged | ✓ VERIFIED | `code-islands/index.ts:66-208` — all four procs (`list`/`byId`/`create`/`remove`) are `protectedProcedure`; identity is ALWAYS `ctx.user.id` (`:19-24` header contract); `byId` `:94-96` and `remove` `:198-200` assert ownership at the TOP via `assertCodeIslandOwnership` (`packages/db/src/ownership.ts`, added in `b64c56c3`) → NOT_FOUND on missing-or-not-yours (no existence oracle); `list` filters on `ctx.user.id` (`:81`); `remove`'s DELETE re-scopes on user_id (`:204`, defense in depth); `create` stamps owner server-side (`:152`). Generator stayed auth-gate-only (no per-user cache coupling introduced — `code-island.ts` proxy unchanged in posture). DB belt: 0055's owner RLS policies (defense-in-depth per the migration's own header). |
| BTAP-10 | Disposability: deleting the node removes only the placement; the row survives unless explicitly `codeIslands.remove`d | ✓ VERIFIED | `code-island-node.tsx:116` — the node's delete control calls `deleteElements({ nodes: [{ id }] })` only (placement drop; header contract `:27-28` states the row survives); explicit destruction is the separate `codeIslands.remove` (`index.ts:195-208`, ownership-first, idempotent-by-NOT_FOUND). "Your tools" picker (`9e309328`, `code-island-picker-dialog.tsx`) closes the loop: a removed placement can be re-dropped from the surviving row via `codeIslands.list`/`byId`. |

**Score: 9/10 verified · 1 human-gated · 0 gaps.**

## Required Artifacts

| Artifact | Status | Where |
|---|---|---|
| Sandbox data channel | ✓ | `packages/genui/src/sandbox/build-island-srcdoc.ts` (`serializeIslandData` exported via `sandbox/index.ts:24`) |
| `code-island` node type (both allowlists) | ✓ | `packages/capabilities/src/canvas.ts:264-266` + `apps/web/.../node-type-registry.ts` / `node-data-schemas.ts` / `node-types.ts` / `canvas-vocabulary.ts` (`b64c56c3`) |
| `code_islands` table + migrations | ✓ | `packages/db/migrations/0055_code_islands.sql` (PROD-applied 2026-07-26) + `0059_moaning_wrecker.sql` (provenance; prod-applied per `72ead328`, re-verify owed with 0058-0060) + `packages/db/src/schema/code-islands.ts` |
| `codeIslands.*` router + tests | ✓ | `packages/api-client/src/router/code-islands/index.ts` + `code-islands.test.ts`; registered in `root.ts` |
| `code-island-node.tsx` hosting `<CodeIslandFrame data>` | ✓ | `apps/web/src/app/chat/_canvas/code-island-node.tsx`; frame data prop `code-island-frame.tsx:45-53` |
| Typed-inputs manifest, end to end | ✓ | web `genui/code-island.ts:48-143` → FastAPI `genui_code.py:41-179` → use case `generate_code_island.py:105-159` → prompt `genui_code_generator_adapter.py:319-327` |
| Summon flow + intent dialog + picker | ✓ | `build-tool-flow.ts`, `chat-canvas.tsx:1053-1248`, `build-tool-dialog.tsx`, `code-island-picker-dialog.tsx`, `add-node-menu.tsx` |
| Agent seam (76-05) | ✓ (dark) | listener `chat_tools.py:459-583` + `chat_turn_providers.py:314-324`; web `agent-code-island-reconcile.ts` |

## Live / Operational Notes (context, not code gaps)

- **Prod degradation (incident, 2026-08-06):** both Supabase projects were auto-paused (9 days) and
  restored with CHANGED DB passwords; Vercel env + local `.env.production`/`.env.staging` are stale,
  so **prod web DB — and with it `codeIslands.create` / the live summon loop — is currently down**
  pending Pedro's password reset + paste. The summon loop was proven LIVE in prod on 2026-07-26
  (0055 applied + verified against the DB); today's outage is ops, not Phase 76 code. `/api/dbcheck`
  diagnostic stays on `main` until prod DB is verified, then delete.
- **Remaining Pedro-gated seams touching this phase:** BTAP-07 live loop (`CANVAS_EMIT_TOOL_ENABLED`
  flip + running stack); prod migration verify for 0058-0060 via the migrate pipeline once the 3
  `PROD_*` secrets exist; the real-browser screenshot pass over the summon UI (jsdom does no layout
  — standing rule from the rendered-geometry blind spot).

## Gaps Summary

None at the code level. All ten SPEC criteria are either independently code-verified (9) or a
named, deliberately flag-gated live seam (BTAP-07). Two honest caveats are recorded rather than
hidden: BTAP-03's SPEC-named reactive vitest was never written (mechanism verified by inspection;
covered operationally by the owed real-browser pass), and BTAP-06's "idempotent re-run" shipped as
distinct-tool-per-deliberate-summon + in-flight guard + provenance-upsert on the agent path (the
coherent reading for a non-deterministic generator, documented in-code at `chat-canvas.tsx:1063-1066`).

---
*Verified: 2026-08-06 — retroactive goal-backward audit (orchestrator-run provenance)*
*Verifier: Claude (wrap-up session subagent)*
