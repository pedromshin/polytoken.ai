"use client";

import { Button } from "@polytoken/ui/button";

import type { ComponentRole } from "./region-overlay-box";

/** The three assignable roles (null = unclassified, cleared separately). */
type AssignableRole = NonNullable<ComponentRole>;

const ROLE_OPTIONS: ReadonlyArray<{ value: AssignableRole; label: string }> = [
  { value: "entity", label: "Entity" },
  { value: "field", label: "Field" },
  { value: "unrelated", label: "Unrelated" },
];

/** Active-state classes per role (09-UI-SPEC §INSPECTOR → Role Picker). */
const ACTIVE_CLASS: Record<AssignableRole, string> = {
  entity: "bg-graph-entity/10 text-graph-entity border-graph-entity/30",
  field: "bg-graph-email-component/10 text-graph-email-component border-graph-email-component/30",
  unrelated: "bg-graph-email/10 text-graph-email border-graph-email/30",
};

interface RolePickerProps {
  readonly value: ComponentRole;
  /** Assign a role (entity/field/unrelated) or null to clear (unclassified). */
  readonly onSelect: (role: ComponentRole) => void;
}

/**
 * RolePicker — a static segmented entity|field|unrelated group (D-11).
 *
 * No fetch — the role values are a known enum. Each option is an outline button
 * that picks up a role-color active state; a "Clear role" ghost sets role null.
 */
export function RolePicker({ value, onSelect }: RolePickerProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Role
      </p>
      <div
        className="flex gap-1"
        role="group"
        aria-label="Region role"
      >
        {ROLE_OPTIONS.map((opt) => {
          const isActive = value === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={isActive}
              className={`flex-1 ${isActive ? ACTIVE_CLASS[opt.value] : ""}`}
              onClick={() => onSelect(opt.value)}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
      {value !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => onSelect(null)}
        >
          Clear role
        </Button>
      )}
    </div>
  );
}
