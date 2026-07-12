"use client";

/**
 * edit-params-control.tsx — EditParamsControl: the toolbar's
 * `SlidersHorizontal` icon-button entry point for PANL-02 (Parameter Editor
 * Popover, 52-UI-SPEC.md Component 2). Replaces Plan 52-02's inert
 * interface-first skeleton (52-03-PLAN.md Task 3).
 *
 * Bounded, schema-driven param editing — NO free-form JSON is ever offered
 * (52-CONTEXT.md, locked). `editableFieldsFor`/`PanelEditParamsSchema` are
 * imported from `@polytoken/api-client`'s `./genui/panel-edit-schema` export
 * subpath (mirrors the `./chat-canvas` precedent already used for
 * `CanvasSnapshotSchema`) — ONE whitelist shared by client and server, never
 * a hand-duplicated copy. Client-side field validation here is a THIN
 * convenience mirror for fast inline feedback; the AUTHORITATIVE gate is
 * `genui.applyPanelEdit`'s own server-side `SpecRootSchema.safeParse`
 * re-validation (FOUND-6). A server rejection shows the exact banner copy
 * below and NEVER clears the typed values — no partial apply. A panel whose
 * root type has no editable params (`editableFieldsFor` returns `[]`) shows
 * the button disabled with the "no editable parameters" tooltip — no
 * popover is ever offered for it.
 */

import * as React from "react";
import { useMemo, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";

import { SpecRootSchema } from "@polytoken/genui/schema";
import {
  editableFieldsFor,
  type PanelEditFieldDescriptor,
  type PanelEditParams,
} from "@polytoken/api-client/genui/panel-edit-schema";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Label } from "@polytoken/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polytoken/ui/select";
import { Textarea } from "@polytoken/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import { api } from "~/trpc/react";

import { appendVersion } from "../panel-overlay";
import { usePanelOverlay, type PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

const SERVER_ERROR_COPY = "Couldn't save these changes — check the highlighted fields.";

const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Title",
  description: "Description",
  heading: "Heading",
  gap: "Gap",
  direction: "Direction",
  cols: "Columns",
};

const ENUM_OPTION_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  vertical: "Vertical",
  horizontal: "Horizontal",
};

type FormValues = Record<string, string>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * readActiveRoot(specJson) — degrade-not-throw parse (mirrors
 * panel-overlay.ts's readBaseSpecPackId): returns the root's type + its
 * current field values, or undefined for an unparsable/invalid spec.
 */
function readActiveRoot(specJson: string): { type: string; values: Record<string, unknown> } | undefined {
  try {
    const candidate: unknown = JSON.parse(specJson);
    const parsed = SpecRootSchema.safeParse(candidate);
    if (!parsed.success) return undefined;
    return { type: parsed.data.root.type, values: parsed.data.root as Record<string, unknown> };
  } catch {
    return undefined;
  }
}

/**
 * initialValuesFor(fields, rootValues) — seeds one string value per editable
 * field from the root's CURRENT value. An unset optional field (e.g. a grid
 * with no explicit `cols`) seeds with a sane concrete default (the enum's
 * first option, or a number field's own `min` bound) — the bounded editor
 * always shows a valid starting value, never a blank that immediately fails
 * client-side validation.
 */
function initialValuesFor(
  fields: readonly PanelEditFieldDescriptor[],
  rootValues: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = rootValues[field.key];
    if (raw !== undefined && raw !== null) {
      values[field.key] = String(raw);
      continue;
    }
    if (field.kind === "enum") {
      values[field.key] = field.options?.[0] ?? "";
    } else if (field.kind === "number") {
      values[field.key] = String(field.min ?? 0);
    } else {
      values[field.key] = "";
    }
  }
  return values;
}

/** fieldError(field, value) — thin client-side mirror of the server's own
 * bound (PanelEditParamsSchema) for fast inline feedback only. */
function fieldError(field: PanelEditFieldDescriptor, value: string): string | null {
  if (field.kind === "string" || field.kind === "text") {
    if (field.max !== undefined && value.length > field.max) {
      return `${field.max} characters max`;
    }
    return null;
  }
  if (field.kind === "number") {
    const n = Number(value);
    const belowMin = field.min !== undefined && n < field.min;
    const aboveMax = field.max !== undefined && n > field.max;
    if (!Number.isInteger(n) || belowMin || aboveMax) {
      return `Range: ${field.min}–${field.max}`;
    }
    return null;
  }
  return null; // enum fields are picked from a closed Select — always valid
}

/** buildParamsPayload(fields, values) — pure: string form values -> the
 * typed PanelEditParams payload sent to genui.applyPanelEdit. */
function buildParamsPayload(
  fields: readonly PanelEditFieldDescriptor[],
  values: FormValues,
): PanelEditParams {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? "";
    payload[field.key] = field.kind === "number" ? Number(raw) : raw;
  }
  return payload as PanelEditParams;
}

// ---------------------------------------------------------------------------
// EditParamField — one labeled row per 52-UI-SPEC.md's field-type mapping
// ---------------------------------------------------------------------------

interface EditParamFieldProps {
  readonly field: PanelEditFieldDescriptor;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

function EditParamField({ field, value, error, onChange }: EditParamFieldProps): React.ReactElement {
  const fieldId = `edit-param-${field.key}`;
  const label = FIELD_LABELS[field.key] ?? field.key;

  return (
    <div className="space-y-1">
      <Label htmlFor={fieldId} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {field.kind === "string" && (
        <Input
          id={fieldId}
          value={value}
          maxLength={field.max}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.kind === "text" && (
        <Textarea
          id={fieldId}
          rows={3}
          value={value}
          maxLength={field.max}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.kind === "enum" && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={fieldId} aria-label={label} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {ENUM_OPTION_LABELS[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.kind === "number" && (
        <Input
          id={fieldId}
          type="number"
          min={field.min}
          max={field.max}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {(field.kind === "string" || field.kind === "text") && field.max !== undefined && (
        <p className="text-xs text-muted-foreground">{field.max} characters max</p>
      )}
      {field.kind === "number" && (
        <p className="text-xs text-muted-foreground">
          Range: {field.min}–{field.max}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditParamsControl
// ---------------------------------------------------------------------------

export function EditParamsControl({
  panelId,
  activeSpecJson,
  isLocked,
  onBusyChange,
}: PanelActionControlProps): React.ReactElement {
  const { overlay, writeOverlay } = usePanelOverlay(panelId);
  const mutation = api.genui.applyPanelEdit.useMutation();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>({});
  const [initialValues, setInitialValues] = useState<FormValues>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const active = useMemo(() => readActiveRoot(activeSpecJson), [activeSpecJson]);
  const fields = active !== undefined ? editableFieldsFor(active.type) : [];

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen && active !== undefined) {
      const seeded = initialValuesFor(fields, active.values);
      setValues(seeded);
      setInitialValues(seeded);
      setServerError(null);
    }
    setOpen(nextOpen);
  }

  function handleDiscard(): void {
    setValues(initialValues);
    setServerError(null);
    setOpen(false);
  }

  function handleSave(): void {
    setServerError(null);
    onBusyChange(true);
    const params = buildParamsPayload(fields, values);

    mutation.mutate(
      { currentSpecJson: activeSpecJson, params },
      {
        onSuccess: (result) => {
          onBusyChange(false);
          if (!result.ok || result.spec === undefined) {
            setServerError(SERVER_ERROR_COPY);
            return;
          }
          writeOverlay(
            appendVersion(overlay, {
              generatedBy: "edit",
              specJson: JSON.stringify(result.spec),
              params,
            }),
          );
          setOpen(false);
        },
        onError: () => {
          onBusyChange(false);
          setServerError(SERVER_ERROR_COPY);
        },
      },
    );
  }

  if (fields.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Edit parameters"
            disabled
            className={PANEL_ACTION_ICON_BUTTON_CLASS}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>This panel has no editable parameters</TooltipContent>
      </Tooltip>
    );
  }

  const isDirty = fields.some((field) => values[field.key] !== initialValues[field.key]);
  const isValid = fields.every((field) => fieldError(field, values[field.key] ?? "") === null);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Edit parameters"
              disabled={isLocked}
              className={PANEL_ACTION_ICON_BUTTON_CLASS}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit parameters</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="bottom" className="w-80 space-y-3">
        <p className="text-xs font-semibold text-foreground">Edit panel parameters</p>
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {serverError}
          </div>
        )}
        <div className="space-y-3">
          {fields.map((field) => (
            <EditParamField
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              error={fieldError(field, values[field.key] ?? "")}
              onChange={(next) => setValues((prev) => ({ ...prev, [field.key]: next }))}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={handleDiscard}>
            Discard changes
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!isDirty || !isValid || mutation.isPending}
            onClick={handleSave}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
