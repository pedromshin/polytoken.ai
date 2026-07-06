"use client";

/**
 * form-component.tsx — the interactive renderer for the declarative `form` node (Phase 19).
 *
 * Self-contained controlled form: holds field values + errors in local React state, evaluates
 * conditional visibility/required (FORM-02) from data, validates via the pure no-eval
 * `validateForm` (FORM-03), and on a valid submit resolves `onSubmit` through the ActionRegistry
 * seam (SEAM-02 / FORM-04) — never an arbitrary endpoint. Zero eval / no dangerouslySetInnerHTML.
 *
 * Native controls (styled with the app's design tokens so Phase-17 style packs apply via CSS vars)
 * — the reliable fast-path; exotic forms go to the Phase-20 code-island.
 */

import * as React from "react";

import {
  isFieldRequired,
  isFieldVisible,
  validateForm,
  type FormFieldSpec,
  type FormValue,
  type FormValues,
} from "../form/validate-form";
import { ActionRegistryContext } from "../renderer/action-registry-context";

/** The onSubmit action descriptor (a validated ActionSchema value at the wire boundary). */
export interface FormSubmitAction {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface FormComponentProps {
  readonly title?: string;
  readonly description?: string;
  readonly fields: readonly FormFieldSpec[];
  readonly submitLabel?: string;
  readonly onSubmit?: FormSubmitAction;
  /** 24-05 fix pass (24-UI-REVIEW.md Top Priority Fix #1): when true, suppresses this
   * component's own internal "Submitted ✓" affordance. A host chrome that wraps this
   * form with its own submitted/submitting signal (InteractiveWidgetBoundary's
   * "Submitting…" row + "Submitted" badge) is the SOLE source of truth for that state
   * in that context — this component's own affordance would otherwise co-render a
   * contradictory second status channel (see form-component.tsx's module doc).
   * Defaults to unset/false — every standalone (Phase-19 studio) usage is unaffected. */
  readonly hideOwnSubmittedAffordance?: boolean;
}

const CONTROL_CLASS =
  "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

function initialValues(fields: readonly FormFieldSpec[]): FormValues {
  const values: Record<string, FormValue> = {};
  for (const field of fields) {
    values[field.name] = field.defaultValue ?? (field.fieldType === "checkbox" ? false : "");
  }
  return values;
}

function htmlInputType(fieldType: FormFieldSpec["fieldType"]): string {
  switch (fieldType) {
    case "email":
      return "email";
    case "number":
      return "number";
    case "tel":
      return "tel";
    case "url":
      return "url";
    case "password":
      return "password";
    default:
      return "text";
  }
}

interface FieldViewProps {
  readonly field: FormFieldSpec;
  readonly value: FormValue;
  readonly error: string | undefined;
  readonly required: boolean;
  readonly onChange: (name: string, value: FormValue) => void;
}

function FieldView({ field, value, error, required, onChange }: FieldViewProps): React.ReactElement {
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy =
    [field.helpText ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const fieldType = field.fieldType ?? "text";
  const labelText = required ? `${field.label} *` : field.label;

  const help = field.helpText ? (
    <p id={helpId} className="mt-1 text-xs text-muted-foreground">
      {field.helpText}
    </p>
  ) : null;
  const errorEl = error ? (
    <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
      {error}
    </p>
  ) : null;

  // checkbox — control precedes an inline label
  if (fieldType === "checkbox") {
    return (
      <div>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(field.name, e.target.checked)}
            className="size-4 rounded border-input"
          />
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {labelText}
          </label>
        </div>
        {help}
        {errorEl}
      </div>
    );
  }

  // radio — fieldset + legend + options
  if (fieldType === "radio") {
    return (
      <fieldset aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        <legend className="text-sm font-medium text-foreground">{labelText}</legend>
        <div className="mt-1 grid gap-1">
          {(field.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={field.name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(field.name, opt.value)}
                className="size-4 border-input"
              />
              {opt.label}
            </label>
          ))}
        </div>
        {help}
        {errorEl}
      </fieldset>
    );
  }

  // labelled control (input / textarea / select)
  const control =
    fieldType === "textarea" ? (
      <textarea
        id={id}
        value={String(value ?? "")}
        placeholder={field.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(field.name, e.target.value)}
        className={`${CONTROL_CLASS} min-h-20`}
      />
    ) : fieldType === "select" ? (
      <select
        id={id}
        value={String(value ?? "")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(field.name, e.target.value)}
        className={CONTROL_CLASS}
      >
        <option value="">{field.placeholder ?? "Select…"}</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        type={htmlInputType(fieldType)}
        value={String(value ?? "")}
        placeholder={field.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(field.name, e.target.value)}
        className={CONTROL_CLASS}
      />
    );

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {labelText}
      </label>
      {control}
      {help}
      {errorEl}
    </div>
  );
}

export function FormComponent({
  title,
  description,
  fields,
  submitLabel = "Submit",
  onSubmit,
  hideOwnSubmittedAffordance = false,
}: FormComponentProps): React.ReactElement {
  const registry = React.useContext(ActionRegistryContext);
  const [values, setValues] = React.useState<FormValues>(() => initialValues(fields));
  const [errors, setErrors] = React.useState<Readonly<Record<string, string>>>({});
  const [submitted, setSubmitted] = React.useState(false);

  const handleChange = React.useCallback((name: string, value: FormValue): void => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setSubmitted(false);
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent): void => {
      e.preventDefault();
      const result = validateForm(fields, values);
      setErrors(result.errors);
      if (!result.valid) {
        setSubmitted(false);
        return;
      }
      // FORM-04: resolve onSubmit ONLY through the allowlisted ActionRegistry seam (SEAM-02).
      // 24-04 Task 2: the handler also receives the submitted FormValues snapshot (immutable
      // spread — never mutates onSubmit) — the same class of additive wiring 23-06 applied to
      // ButtonComponent. Invisible to the wire schema: onSubmit's own shape is unchanged, this
      // is a runtime payload enrichment only.
      if (onSubmit) {
        try {
          registry[onSubmit.type]?.({ ...onSubmit, values });
        } catch {
          // best-effort — a failed handler must not break the form
        }
      }
      setSubmitted(true);
    },
    [fields, values, onSubmit, registry],
  );

  const visibleFields = fields.filter((field) => isFieldVisible(field, values));

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={title ?? "Form"}
      className="nauta-form grid gap-4"
    >
      {title ? <h3 className="text-lg font-semibold text-foreground">{title}</h3> : null}
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}

      {visibleFields.map((field) => (
        <FieldView
          key={field.name}
          field={field}
          value={values[field.name]}
          error={errors[field.name]}
          required={isFieldRequired(field, values)}
          onChange={handleChange}
        />
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {submitLabel}
        </button>
        {submitted && !hideOwnSubmittedAffordance ? (
          <span role="status" className="text-sm text-emerald-600">
            Submitted ✓
          </span>
        ) : null}
      </div>
    </form>
  );
}
