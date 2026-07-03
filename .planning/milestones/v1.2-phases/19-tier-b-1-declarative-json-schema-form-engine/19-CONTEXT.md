# Phase 19: Tier B-1 — Declarative Form Engine - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning → executing
**Mode:** Reordered to run AFTER Phase 20 (code-island). Decision informed by the island.

<domain>
## Phase Boundary

A declarative, **zero-eval** `form` node in the existing spec vocabulary — the *reliable fast-path* half
of the hybrid (the code-island, Phase 20, is the escape hatch for exotic/arbitrary forms). Covers the
bulk of the corpus's Tier-B form interactivity (lead-capture, onboarding, invoice, lead-gen, multi-field)
inside the trusted declarative core, composing with Phase-17 style packs + Phase-18 input primitives.
Requirements: FORM-01..05.
</domain>

<decisions>
## Implementation Decisions

### Approach: HYBRID (user-chosen 2026-07-01)
- Declarative `form` node (fast-path, reliable/cacheable/a11y-consistent) + code-island fallback for
  exotic forms. Do NOT build a second arbitrary form runtime — the island already does that.

### CRITICAL — validation engine: NO-EVAL (AJV rejected)
- The user's option said "custom + AJV", but **AJV compiles model-provided JSON Schema via `new Function`**
  (its whole speed model) — that would break the declarative core's zero-eval invariant (GR-01 / D-24),
  the exact property that makes the hybrid's "reliable core" reliable. So AJV is REJECTED for the runtime
  declarative path.
- **Chosen: a bounded, custom, pure no-eval validator** over a typed field-spec (not raw JSON-Schema-draft),
  giving full control, zero new dependency, guaranteed no-eval, and tailored per-field errors. This also
  fits the existing Zod-schema/registry architecture better than a JSON-Schema-draft dependency.
  (`@cfworker/json-schema` — an interpreter, no codegen — was the alternative if raw JSON-Schema fidelity
  were required; not needed here.)

### Field-spec (declarative, data-not-code)
- `form` node: `title?`, `description?`, `fields[]` (min 1), `submitLabel?`, `onSubmit?` (ActionSchema).
- `FormField`: `name`, `label` (a11y REQUIRED), `fieldType` (text/email/number/tel/url/password/textarea/
  select/checkbox/radio — NOT `type`, avoids discriminant collision, GOTCHA-1), `placeholder?`, `required?`,
  `options?` (select/radio), `min?/max?/minLength?/maxLength?/pattern?`, `helpText?`, `defaultValue?`,
  `visibleWhen?`/`requiredWhen?` (FieldCondition `{field, equals}` — FORM-02 conditional logic as DATA).

### FORM-03 validation
- Pure `validateForm(fields, values) → {valid, errors}` at change + submit; inline field-level errors;
  required/requiredWhen, type (email/number/url/tel), min/max, minLength/maxLength, pattern (RegExp
  construction is not eval; execution length-guarded for ReDoS), enum membership for select/radio.

### FORM-04 submit
- `onSubmit` is an `ActionSchema` (navigate/setState/mutate) resolved through the `ActionRegistry`
  (SEAM-02) — no arbitrary endpoint. `mutate` stays inert (ALLOWED_MUTATIONS = []). On valid submit the
  form also surfaces a local success state so the sandbox demo is observable even with an empty registry.

### Parity + drift discipline (Phase-18)
- Wire `FormNodeSchema` (in the discriminated union, `.strict()`) and manifest `propsSchema` (`.strict()`)
  share the exported `FormFieldSchema`/`FieldConditionSchema` to eliminate drift by construction.
- a11y-required (`label`) non-optional in BOTH. Re-emit Bedrock artifacts (drift gate) + REGISTRY_VERSION
  bump (content hash). Standing wire/render parity test covers the new entry.
</decisions>

<code_context>
## Existing Code Insights
- Node pattern: `spec-schema.ts` discriminated union (18 nodes) + `catalog/types.ts` `SpecNodeType` +
  `catalog/manifest.ts` entry (description/example/`.strict()` propsSchema/component) + `renderNode`
  dispatch (validated props only; actions via `useContext(ActionRegistryContext)`).
- Phase-18 inputs (`input` node) + `ActionSchema` (imported in spec-schema line 30) + `ActionRegistry`
  (`Readonly<Record<string, ActionHandler>>`, keys navigate/setState/query-refresh).
- Artifacts re-emit: `npm run gen:artifacts`; REGISTRY_VERSION = SHA-256 content hash (auto).
</code_context>

<specifics>
## Specific Ideas
- Corpus form prompts (FORM-05): client-onboarding (#18), lead-capture (#25), invoice (#20), MVP scope
  calculator (#27) — the studio demo/example uses a realistic multi-field form with a conditional field.
</specifics>

<deferred>
## Deferred Ideas
- Live Bedrock eval-harness lift on form-heavy corpus (FORM-05 measurable lift) → connected-env (DEF-19-01),
  same posture as DEF-17-05-01 / DEF-18-03-01 / DEF-20-01.
- Multi-step/wizard forms, file uploads, async field validation → future.
</deferred>
