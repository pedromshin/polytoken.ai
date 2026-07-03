# Phase 12: Catalog, Spec Schema, and Trusted Interpreter - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-27
**Phase:** 12-catalog-spec-schema-and-trusted-interpreter
**Areas discussed:** Catalog scope, First demo spec, Registry version scheme, Studio preview scope

---

## Catalog scope

| Option | Description | Selected |
|--------|-------------|----------|
| Lean real set (~10) | Layout primitives (stack, grid) + ~8 leaves authored fully real: text, badge, button, card, key-value-list, separator, alert, table. Strict Zod, a11y-required marks, CI example test. Matches depth-first. | ✓ |
| Minimal spine (~5) | Just enough to prove the interpreter: stack, card, text, badge, button. Fastest; thin vocabulary, sparse demo. | |
| Broad set (~18-20) | Cover most @nauta/ui leaves now. Bigger surface, thinner per-entry depth this phase. | |

**User's choice:** Lean real set (~10)
**Notes:** Aligns with the user's standing depth-first / no-stubs preference — small set built for real over broad coverage.

---

## First demo spec

| Option | Description | Selected |
|--------|-------------|----------|
| Nauta-flavored card | Extracted-invoice / email-summary card with dataRef bindings, a toggle (state + conditional), status badge. Foreshadows real use. | |
| Generic showcase | One of every node type, no domain meaning — maximizes schema coverage. | ✓ |
| Both fixtures | Nauta card + coverage showcase. More test surface, two specs. | |

**User's choice:** Generic showcase
**Notes:** Claude flagged that the showcase must still satisfy the hard success criteria — it will include ≥1 declared state primitive + action and ≥1 dotted-path dataRef, and a separate malformed-node fixture proves error-boundary isolation (criteria 3 & 4). Nauta-flavored real demo deferred.

---

## Registry version scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Content-hash (auto) | SHA-256 over catalog entries; any catalog change auto-bumps version → Phase 14 cache auto-invalidates with no manual step. Serves CACHE-04. | ✓ |
| Manual semver | Explicit REGISTRY_VERSION constant bumped by hand. Readable, easy to forget. | |
| Hybrid (semver + hash) | Readable major + content-hash suffix. Best of both, more machinery. | |

**User's choice:** Content-hash (auto)
**Notes:** Chosen for the automatic cache-invalidation seam into Phase 14 (CACHE-04 "no manual flush"). Key shape left per-catalog-id capable for SEAM-03.

---

## Studio preview scope

| Option | Description | Selected |
|--------|-------------|----------|
| Render + JSON inspector | /studio/preview shows live render AND spec JSON side-by-side (read-only). Pulls STDO-03 forward — trivial cost, aids Phase 13-14 debugging. | ✓ |
| Bare render-only | Just mount SpecRenderer on the hardcoded spec. Full studio waits for Phase 15. | |

**User's choice:** Render + JSON inspector
**Notes:** Slight pull-forward of STDO-03 accepted as low-cost / high-value. Full studio browser + generation sandbox stay in Phase 15. Mounted as a `dynamic(ssr:false)` client island (Phase 11 `/knowledge` precedent).

---

## Claude's Discretion

- Exact final 8 leaf components within the endorsed ~10 envelope.
- Internal `packages/genui` module layout; subpath vs barrel `@nauta/ui` imports.
- `/studio/preview` render+JSON split layout/styling.
- Empty `ActionRegistry` context shape (seam only this phase).
- Whether node/depth bounds live as `.refine()` or a separate validator.

## Deferred Ideas

- LLM generation + guardrails — Phase 13.
- Exact cache + template store — Phase 14.
- Full `/studio` surface (browser + sandbox + state indicators) — Phase 15.
- Nauta-flavored real demo (email/entity-bound spec) — later convergence (v1.2).
- Candidate-component subsetting logic — seam only at ~10 components (COST-03).
- Per-node persistent state (Jotai atomFamily), progressive streaming, semantic retrieval, code-emit — v1.2 / out of milestone.
