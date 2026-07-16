"use client";

/**
 * edge-creation-picker.tsx — EdgeCreationPicker: the connect-time gate for a
 * data-carrying edge (STATE-02, D-09, FOUND-6, T-23-13). Anchored as a
 * `Popover` at the drop point (create mode) or at the clicked label pill
 * (edit mode, pre-filled). The edge is NOT created/updated until the user
 * explicitly confirms "Connect fields" — a validation failure keeps the
 * picker open with the inline error copy instead of committing a broken
 * edge; "Don't connect" / closing the popover creates nothing (never
 * auto-fires).
 *
 * Field discovery (Claude's Discretion, 23-UI-SPEC.md D-09): this
 * architecture has no fixed "target accepted keys" registry — every genui
 * panel's rendered spec is dynamically LLM-generated, so there is no schema
 * enumerating what a given panel "accepts". Source field is a `Select`
 * populated from the CURRENT known keys already written into the source
 * panel's own `panels.{id}.*` bucket (plus `shared.*`) — the "no compatible
 * fields" copy applies exactly when that panel has written nothing yet
 * (23-UI-SPEC.md's own anticipated edge case). Target field is a validated
 * free-text `Input` (with a `<datalist>` of the target panel's own current
 * keys as suggestions) rather than a second closed dropdown, since
 * constraining it to a nonexistent "accepted keys" enum would silently
 * block legitimate new bindings.
 */

import { useMemo, useState } from "react";
import { useStore } from "zustand";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@polytoken/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polytoken/ui/select";

import { useCanvasStore } from "./canvas-store-context";
import { EdgePayloadSchema, type EdgePayload } from "./edge-payload-schema";

export function panelFieldOptions(values: Record<string, unknown>, panelId: string): string[] {
  const panels = values.panels as Record<string, unknown> | undefined;
  const own = (panels?.[panelId] as Record<string, unknown> | undefined) ?? {};
  return Object.keys(own)
    .sort()
    .map((key) => `panels.${panelId}.${key}`);
}

export function sharedFieldOptions(values: Record<string, unknown>): string[] {
  const shared = (values.shared as Record<string, unknown> | undefined) ?? {};
  return Object.keys(shared)
    .sort()
    .map((key) => `shared.${key}`);
}

function lastSegment(path: string): string {
  const segments = path.split(".");
  return segments[segments.length - 1] ?? path;
}

export interface EdgeCreationPickerProps {
  /** Screen-space anchor point (fixed positioning) — the drop point for a
   * new connection, or the clicked label pill's position when editing. */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly sourcePanelId: string;
  readonly targetPanelId: string;
  readonly initialSourcePath?: string;
  readonly initialTargetKey?: string;
  /** Only true when re-opening the picker for an ALREADY-committed edge —
   * shows the "Remove connection" action (no confirmation dialog, low-stakes
   * per 23-UI-SPEC.md). */
  readonly isEditing: boolean;
  readonly onConfirm: (payload: EdgePayload) => void;
  readonly onCancel: () => void;
  readonly onRemove?: () => void;
}

export function EdgeCreationPicker({
  anchor,
  sourcePanelId,
  targetPanelId,
  initialSourcePath,
  initialTargetKey,
  isEditing,
  onConfirm,
  onCancel,
  onRemove,
}: EdgeCreationPickerProps): React.ReactElement {
  const store = useCanvasStore();
  const values = useStore(store, (state) => state.values);

  const sourceFieldOptions = useMemo(
    () => [...panelFieldOptions(values, sourcePanelId), ...sharedFieldOptions(values)],
    [values, sourcePanelId],
  );
  const targetFieldSuggestions = useMemo(
    () => panelFieldOptions(values, targetPanelId).map(lastSegment),
    [values, targetPanelId],
  );

  const [sourcePath, setSourcePath] = useState(initialSourcePath ?? "");
  const [targetKey, setTargetKey] = useState(initialTargetKey ?? "");
  const [error, setError] = useState<string | null>(null);

  const noCompatibleFields = sourceFieldOptions.length === 0;
  const datalistId = `edge-picker-target-suggestions-${targetPanelId}`;

  function handleConfirm(): void {
    const result = EdgePayloadSchema.safeParse({ sourcePath, targetKey });
    if (!result.success) {
      setError("This value type isn't compatible with the target field.");
      return; // validation failure keeps the picker open — never auto-fires
    }
    setError(null);
    onConfirm(result.data);
  }

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <PopoverAnchor asChild>
        <div
          aria-hidden
          style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 1, height: 1 }}
        />
      </PopoverAnchor>
      <PopoverContent className="w-72 space-y-3" onEscapeKeyDown={onCancel}>
        <p className="text-sm font-semibold text-foreground">Connect panels</p>

        {noCompatibleFields ? (
          <p className="text-xs text-muted-foreground">
            This panel doesn&apos;t expose any fields yet — add state to it first.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="edge-picker-source">
                Source field
              </label>
              <Select value={sourcePath} onValueChange={setSourcePath}>
                <SelectTrigger id="edge-picker-source">
                  <SelectValue placeholder="Select a field" />
                </SelectTrigger>
                <SelectContent>
                  {sourceFieldOptions.map((path) => (
                    <SelectItem key={path} value={path}>
                      {path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="edge-picker-target">
                Target field
              </label>
              <Input
                id="edge-picker-target"
                list={datalistId}
                value={targetKey}
                onChange={(event) => setTargetKey(event.target.value)}
                placeholder="e.g. label"
              />
              <datalist id={datalistId}>
                {targetFieldSuggestions.map((key) => (
                  <option key={key} value={key} />
                ))}
              </datalist>
            </div>
          </>
        )}

        {error && <p className="text-xs font-medium text-ink">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {isEditing && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
            >
              Remove connection
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Don&apos;t connect
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleConfirm}
              disabled={noCompatibleFields || !sourcePath || !targetKey}
            >
              Connect fields
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
