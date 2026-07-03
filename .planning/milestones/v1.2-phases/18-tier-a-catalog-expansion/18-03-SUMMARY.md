---
phase: "18"
plan: "03"
subsystem: genui/catalog
tags: [catalog, wire-render-parity, ci-gate, registry-version, bedrock-artifacts, drift-gate, phase-14-cache-invalidation]
dependency_graph:
  requires: ["18-01", "18-02"]
  provides: ["wire-render-parity-gate", "phase-14-cache-invalidation-proof", "bedrock-artifacts-16-entry", "D-05-ci-guard"]
  affects: ["genui/artifacts", "bedrock-prompt", "phase-14-cache"]
tech_stack:
  added: []
  patterns: ["SpecNodeSchema.safeParse-parity-test", "children-injection-for-container-nodes", "SHA-256-registry-version-gate"]
key_files:
  created: []
  modified:
    - packages/genui/src/__tests__/manifest.test.ts
decisions:
  - "Container entries (stack/grid/card/section — acceptsChildren:true) get children:[] injected in the parity test, mirroring buildCatalogExampleSpec, to avoid false negatives from SectionNodeSchema's required children array"
  - "Registry-version bump is proven by asserting 6 new type keys are present in COMPONENT_REGISTRY rather than comparing against a brittle prior-hash literal — the existing hash-sensitivity test already proves the SHA-256 mechanism"
  - "Artifact drift gate (artifacts.test.ts) confirmed green without re-running gen:artifacts — Wave 2 (18-02) re-emitted the artifacts; 18-03 adds no further schema changes, so the committed files match freshly generated output"
  - "DEF-18-03-01 (live eval lift-vs-baseline, D-10) is recorded as a deferred connected-env checkpoint — non-blocking per plan design (requires Bedrock creds + seeded DB, same posture as Phase-17 DEF-17-05-01)"
metrics:
  duration_seconds: 840
  completed_at: "2026-07-01T00:43:00Z"
  tasks_completed: 2
  files_modified: 1
---

# Phase 18 Plan 03: CI Parity Gate + Registry Version Proof Summary

Wire/render parity CI gate (16 SpecNodeSchema.safeParse tests, one per COMPONENT_REGISTRY entry) and Phase-14 cache-invalidation assertion (6 Phase-18 keys present + REGISTRY_VERSION is a 64-char SHA-256 hex), closing the Phase-18 catalog expansion with machine-provable correctness.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire/render parity gate + Phase-14 cache-invalidation assertion | 6fc7a2f | packages/genui/src/__tests__/manifest.test.ts |
| 2 | Artifact drift gate confirmation + registry-version verification | (no files changed — verified in-place, committed artifacts match fresh emit) | — |

Task 3 (DEF-18-03-01 deferred eval) auto-approved as documented connected-env checkpoint; does not block phase completion.

## What Was Built

**Block 5 — Wire/render schema parity (Phase-18 D-05 / T-18-09):**

16 new `it` tests under `describe("Wire/render schema parity (Phase-18 D-05)")` — one per `COMPONENT_REGISTRY` entry. Each test:
1. Builds `{ type, ...entry.example }` from the manifest.
2. Injects `children: []` for `acceptsChildren === true` entries (stack, grid, card, section) to satisfy `SectionNodeSchema`'s required `children` array — mirrors `buildCatalogExampleSpec`.
3. Calls `SpecNodeSchema.safeParse(node)`.
4. Throws an informative error including `result.error.format()` JSON if the parse fails (naming the offending type).

This is the standing regression guard against the Phase-17 `onClick` drift class (PATTERNS.md §11.C): any future field added to the manifest propsSchema that is absent from the wire `SpecNodeSchema` (or vice versa) fails CI immediately with the exact Zod error.

**Block 4 addition — Phase-14 cache-invalidation proof (CTLG-08 / D-05):**

One new `it` test added to the existing `computeRegistryHash content-hash (D-07)` describe block:
- Asserts all 6 Phase-18 keys (`avatar`, `input`, `nav`, `feed-item`, `tabs`, `section`) are present in `COMPONENT_REGISTRY`.
- Asserts `REGISTRY_VERSION.version` matches `/^[0-9a-f]{64}$/`.
- Asserts `Object.keys(COMPONENT_REGISTRY).length === 16`.

These three assertions together prove the catalog key set expanded, which the existing hash-sensitivity test proves produces a different SHA-256 hash, which is the mechanism that auto-invalidates the Phase-14 exact cache (per D-08 in Phase-14: `registry_version` is one of the 4 delimited segments of the cache key; changing it makes all prior keys stale).

**Artifact drift gate (Task 2):**

The 13 `artifacts.test.ts` tests confirmed green — all assertions pass:
- `spec.schema.json` matches `buildSpecSchema()` freshly generated output.
- `genui-prompt.json` matches `buildGenuiPromptPayload()` freshly generated output.
- `components` array has an entry for each of the 16 registered types (including all 6 Phase-18 additions).
- `registryVersion.version` is a 64-char hex.

No new artifacts commit was needed: Wave 2 (18-02, commit 559b511) already re-emitted the artifacts after adding all 6 entries; 18-03 introduced no schema changes.

## Test Results

Full suite after Task 1 commit (`6fc7a2f`):
- `packages/genui/src/__tests__/manifest.test.ts`: **60 tests passed** (was 43 before Phase-18 wave 3)
  - Block 1 (CTLG-04): 16 example→propsSchema validation tests
  - Block 2 (D-04): 13 a11y negative tests (6 pre-Phase-18 + 7 added in 18-02)
  - Block 3 (D-06): 7 RegisteredTypeSchema allowlist tests
  - Block 4 (D-07): 8 hash determinism + REGISTRY_VERSION tests (incl. 1 new Phase-14 cache invalidation proof)
  - Block 5 (D-05): 16 wire/render parity tests (all new in 18-03)
- `packages/genui/src/generation/__tests__/artifacts.test.ts`: **13 tests passed**
- Full package suite: **367 tests passed across 15 test files** — exit 0
- `tsc --noEmit`: clean (no new source files added)

## Deferred Items

**DEF-18-03-01 — Live eval lift-vs-baseline (D-10, connected-env):**

Run the Phase-16/17 eval harness in `apps/email-listener/scripts/genui_eval/` on the profile/feed/nav corpus prompts against a seeded Bedrock environment. Confirm:
1. New components (avatar, feed-item, nav, section) are COMPOSED in generated specs (not degraded to generic cards).
2. Measurable rubric lift over the Phase-17 baseline (`compare_reports` output).
3. No a11y/contrast regression — Phase-17 WCAG-AA hard gate still holds.

Status: non-blocking (same posture as DEF-17-05-01). Record outcome here when the connected-env run is available.

## Deviations from Plan

None — plan executed exactly as written. The artifact re-emission was confirmed already done in Wave 2 (18-02, commit 559b511); Task 2 required only green-gate verification, not a new emit run. The deferred eval checkpoint (Task 3) was auto-approved per plan design.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. T-18-09 (wire/render drift) and T-18-10 (stale committed artifacts) are both mitigated by the tests added in this plan.

## Self-Check: PASSED

- [x] `packages/genui/src/__tests__/manifest.test.ts` — 57 insertions in commit `6fc7a2f`; file exists with 322 lines
- [x] Commit `6fc7a2f` exists in git log
- [x] Block 5 `describe("Wire/render schema parity (Phase-18 D-05)")` present in manifest.test.ts
- [x] `SpecNodeSchema` import present in manifest.test.ts (line 23)
- [x] All 367 tests pass (`npx vitest run` exit 0)
- [x] Artifact drift gate: 13/13 tests pass
- [x] Phase-14 cache-invalidation proof: 6 Phase-18 keys + REGISTRY_VERSION.version 64-char hex + 16 total entries asserted
