# Phase 19 — Tier B-1: Declarative Form Engine — SUMMARY

**Executed:** 2026-07-01 (autonomous run; reordered to run after Phase 20). **Status:** ✅ COMPLETE
(functionally); connected-env eval lift deferred (DEF-19-01). Context: [19-CONTEXT.md](./19-CONTEXT.md).

## What shipped
A declarative, **zero-eval** `form` node — the reliable fast-path of the hybrid (Phase-20 code-island
is the exotic-form escape hatch). Covers FORM-01..05 inside the trusted declarative core, composing with
Phase-17 style packs + Phase-18 input primitives; a new catalog entry, so it flows through the existing
generation → cache → render → studio spine with zero new backend.

## Components
- **`packages/genui/src/form/validate-form.ts`** (`@nauta/genui/form`) — pure, zero-eval validator.
  **AJV rejected** (it compiles model JSON Schema via `new Function` → breaks GR-01/D-24); bounded
  field-spec validator instead: required/`requiredWhen`, type (email/number/url/tel), min/max,
  minLength/maxLength, `pattern` (via `new RegExp` construction + ReDoS length-guard + invalid-pattern
  swallow), select/radio enum membership, checkbox-required. `isFieldVisible`/`isFieldRequired` evaluate
  `visibleWhen`/`requiredWhen` conditions (FORM-02, data not code).
- **`packages/genui/src/catalog/form-component.tsx`** — interactive controlled form (native controls,
  a11y: `<label htmlFor>` + `aria-invalid` + `aria-describedby` + `role=alert` errors + fieldset/legend
  for radios); conditional visibility; validates on submit with inline errors; `onSubmit` resolves ONLY
  through the `ActionRegistry` seam (SEAM-02 / FORM-04) — no arbitrary endpoint; local success state.
- **`packages/genui/src/renderer/action-registry-context.ts`** — extracted `ActionRegistryContext`
  into a standalone `"use client"` module (spec-renderer re-exports it). Breaks the manifest↔renderer
  import cycle AND keeps `createContext` out of the RSC server path (fixed a `d.createContext is not a
  function` server-build error).
- **Schema/manifest** — wire `FormNodeSchema` (discriminated union, `.strict()`) + manifest `form`
  propsSchema share the exported `FormFieldSchema`/`FieldConditionSchema` (no drift by construction);
  `label` a11y-required in both; discriminant collision avoided via `fieldType` (GOTCHA-1). Bedrock
  artifacts re-emitted (drift gate green); REGISTRY_VERSION bumped (16→17 registry entries).

## Gates (all green)
- genui `tsc` clean · genui vitest **463** (13 validator + 8 form-render + count bumps) · api-client
  **44** (dist rebuilt) · web `tsc` clean · `next build` green (`/studio` 117 kB) · artifact drift gate
  green · wire↔render parity green · no `eval`/`Function`/`dangerouslySetInnerHTML` on the path.

## FORM-01..05 coverage
1. FORM-01 ✅ declarative field-spec + UI rendered by a schema-driven engine, zero-eval.
2. FORM-02 ✅ conditional show/hide/require as data (`visibleWhen`/`requiredWhen`).
3. FORM-03 ✅ declarative validation, inline field-level errors at submit.
4. FORM-04 ✅ submit binds only to the allowlisted ActionRegistry seam (SEAM-02).
5. FORM-05 ✅ a corpus form (lead-capture, w/ conditional phone) generates + renders end-to-end in the
   catalog/sandbox; **measurable rubric lift vs baseline deferred to connected-env (DEF-19-01)**.

## Deferred (connected-env / non-blocking — DEF-19-01)
Live Bedrock eval-harness lift on form-heavy corpus prompts (same posture as DEF-17-05-01 /
DEF-18-03-01 / DEF-20-01). Also future: multi-step/wizard forms, file uploads, async validation.

## Commit
`ecc7a46`.
