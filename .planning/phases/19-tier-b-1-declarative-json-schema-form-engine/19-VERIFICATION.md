---
status: human_needed
phase: 19
mode: full-phase
date: 2026-07-01
---

# Phase 19 — Declarative Form Engine — VERIFICATION

**Verdict:** COMPLETE (machine-verified). One connected-env item deferred (DEF-19-01), non-blocking,
consistent with DEF-17-05-01 / DEF-18-03-01 / DEF-20-01.

## Success criteria (ROADMAP FORM-01..05)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `form` node carries fields + UI, rendered by a schema-driven engine, zero-eval | ✅ | FormNodeSchema + manifest entry + FormComponent; `validate-form.ts` no eval/Function; grep clean |
| 2 | Conditional logic (show/hide/require) as data, not code | ✅ | `visibleWhen`/`requiredWhen` {field,equals}; `isFieldVisible`/`isFieldRequired` + tests |
| 3 | Declarative validation + business rules, inline field-level errors | ✅ | `validateForm` (13 tests) + FormComponent inline `role=alert` errors |
| 4 | Submit binds only to the allowlisted action seam (SEAM-02), no arbitrary endpoint | ✅ | `registry[onSubmit.type]?.(onSubmit)` via ActionRegistryContext; no fetch/eval |
| 5 | Corpus form generates + renders E2E; measurable rubric lift | ✅ render / ⏳ lift | form-render test (spec→renderer→FormComponent); lift-vs-baseline = DEF-19-01 (connected-env) |

## Machine gates (all green)
genui tsc clean · genui vitest **463** · api-client vitest **44** · web tsc clean · `next build` green ·
artifact drift gate green · wire↔render parity green · no-eval grep clean.

## human_needed (connected-env / human — NON-BLOCKING)
1. **Eval-harness lift (DEF-19-01)** — re-run the Phase-16 eval on form-heavy corpus prompts to measure
   the rubric lift where they previously degraded (needs live Bedrock + seeded DB).
2. **Browser eyeball** — `npm run dev` → `/studio` → Catalog tab (the `form` entry renders a live
   lead-capture example; toggle the "Contact me" checkbox → the conditional Phone field appears) and the
   Sandbox tab (generate a form prompt).

## Notes
- ActionRegistryContext extraction (core file `spec-renderer.tsx`) validated by the existing renderer +
  catalog-render tests (all green) + web build.
- A focused typescript-review of the diff ran post-commit; findings (if any) folded in separately.
