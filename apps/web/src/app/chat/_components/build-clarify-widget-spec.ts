/**
 * build-clarify-widget-spec.ts — buildClarifyWidgetSpec / buildClarifySubmittedSpec: pure
 * declaration -> SpecRoot builders for clarify-widgets (Task 3, 24-04, D-09/D-16).
 *
 * buildClarifyWidgetSpec turns a persisted `interactive_widget` (clarify_widget) declaration
 * into a `form` catalog node that renders through the UNMODIFIED Phase-19 `FormComponent` — no
 * new catalog component, no schema change (24-UI-SPEC.md Clarify-widget layout). Fields map 1:1
 * onto `FormNodeSchema`'s `FormFieldSchema` shape (packages/genui/src/schema/spec-schema.ts);
 * `submitLabel` is passed through VERBATIM — never a "Submit" fallback (the UI-SPEC's MANDATORY
 * posture is enforced server-side at emit time, chat_tools.py's required+minLength schema).
 *
 * buildClarifySubmittedSpec turns the SAME declaration plus the submitted field values into a
 * `key-value-list` catalog node (the D-16 compact submitted view) — one {label, value} row per
 * declared field the submitted values carry a key for; a boolean value renders as "Yes"/"No".
 *
 * Both are pure and total: never throw, never mutate their input. The caller
 * (InteractiveWidgetBoundary) re-validates the output against `SpecRootSchema.safeParse` via
 * `GenuiPartBoundary` — the same FOUND-6 gate every other genui part goes through.
 */

import type { SpecRoot } from "@nauta/genui/schema";

/** The `setState` key the clarify-widget form's `onSubmit` carries — `InteractiveWidgetBoundary`'s
 * actions registry reads this key's `values` payload (24-04 Task 2's FormComponent enrichment:
 * `registry[onSubmit.type]?.({ ...onSubmit, values })`). */
export const CLARIFY_SUBMIT_ACTION_KEY = "clarify.submit";

export type ClarifyFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "number"
  | "email";

export interface ClarifyWidgetFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface ClarifyWidgetField {
  readonly name: string;
  readonly label: string;
  readonly fieldType?: ClarifyFieldType;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly helpText?: string;
  readonly options?: readonly ClarifyWidgetFieldOption[];
}

export interface ClarifyWidgetDeclaration {
  readonly title?: string;
  readonly description?: string;
  readonly submitLabel: string;
  readonly fields: readonly ClarifyWidgetField[];
}

function mappedField(field: ClarifyWidgetField): Record<string, unknown> {
  return {
    name: field.name,
    label: field.label,
    ...(field.fieldType ? { fieldType: field.fieldType } : {}),
    ...(field.required ? { required: field.required } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.helpText ? { helpText: field.helpText } : {}),
    ...(field.options ? { options: field.options } : {}),
  };
}

/**
 * buildClarifyWidgetSpec — declaration -> SpecRoot {v:1, root:{type:"form", ...}}. `fields` map
 * 1:1 onto the declaration; `submitLabel` is the declaration's own value (never a fallback);
 * `onSubmit` is a fixed `setState` action carrying the clarify submit key.
 */
export function buildClarifyWidgetSpec(declaration: ClarifyWidgetDeclaration): SpecRoot {
  const root = {
    type: "form" as const,
    ...(declaration.title ? { title: declaration.title } : {}),
    ...(declaration.description ? { description: declaration.description } : {}),
    fields: declaration.fields.map(mappedField),
    submitLabel: declaration.submitLabel,
    onSubmit: { type: "setState" as const, key: CLARIFY_SUBMIT_ACTION_KEY, value: null },
    // 24-05 fix pass (24-UI-REVIEW.md Top Priority Fix #1): InteractiveWidgetBoundary
    // owns the submitted/submitting signal for this widget (badge + "Submitting…" row)
    // — suppress FormComponent's own internal "Submitted ✓" affordance so the two never
    // co-render a contradictory second status channel.
    hideOwnSubmittedAffordance: true,
  };

  return { v: 1, root } as unknown as SpecRoot;
}

function formatSubmittedValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * buildClarifySubmittedSpec — declaration + submitted values -> SpecRoot
 * {v:1, root:{type:"key-value-list", ...}} (D-16 compact submitted view). `label` is the
 * declaration's own `title` (falls back to "Your response" only for the aria-label, matching
 * the Copywriting Contract's `aria-label={formTitle ?? "Your response"}` rule) — one row per
 * declared field the submitted `values` object carries a key for.
 */
export function buildClarifySubmittedSpec(
  declaration: ClarifyWidgetDeclaration,
  values: Readonly<Record<string, unknown>>,
): SpecRoot {
  const items = declaration.fields
    .filter((field) => Object.prototype.hasOwnProperty.call(values, field.name))
    .map((field) => ({ key: field.label, value: formatSubmittedValue(values[field.name]) }));

  const root = {
    type: "key-value-list" as const,
    label: declaration.title ?? "Your response",
    items,
  };

  return { v: 1, root } as unknown as SpecRoot;
}
