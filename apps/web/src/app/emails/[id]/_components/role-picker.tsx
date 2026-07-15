"use client";

import { Button } from "@polytoken/ui/button";

import { REGION_ROLE_LABEL, REGION_ROLE_SWATCH } from "./region-vocabulary";

import type { ComponentRole } from "./region-overlay-box";

/** The three assignable roles (null = unclassified, cleared separately). */
type AssignableRole = NonNullable<ComponentRole>;

/**
 * The option list. Order and `value` are LOAD-BEARING (T-60-08): each value
 * is the argument handed to `onSelect` and from there to the setRole
 * mutation, so this list is extraction wiring, not presentation.
 */
const ROLE_OPTIONS: ReadonlyArray<{ value: AssignableRole }> = [
  { value: "entity" },
  { value: "field" },
  { value: "unrelated" },
];

/**
 * The SELECTED state. Law 1: "selected states carry NO hue — they use ink
 * weight, underline, rule, fill, and elevation." Pre-60 this was a map of
 * one node-TYPE hue per role (a tinted fill, matching text, and matching
 * border), which broke law 1 twice over: it spent colour on chrome, and it
 * spent it encoding a ROLE, which law 3 reserves for shape. Selection is one
 * state, so it is one treatment — the role is already stated by the swatch
 * inside the button.
 *
 * (The retired tokens are described, never named: `role-hue-ban.test.ts`
 * walks this file line by line and does not read comments as prose. A named
 * literal here would fail the gate that exists to keep it gone — which is
 * the correct trade: a commented-out violation is one paste from live.)
 */
const ACTIVE_CLASS = "bg-shade border-ink text-ink font-semibold";

interface RolePickerProps {
  readonly value: ComponentRole;
  /** Assign a role (entity/field/unrelated) or null to clear (unclassified). */
  readonly onSelect: (role: ComponentRole) => void;
}

/**
 * RolePicker — a static segmented entity|field|unrelated group (D-11).
 *
 * No fetch — the role values are a known enum. Each option is an outline
 * button carrying a MINIATURE of the box treatment that role actually wears
 * on the document (`REGION_ROLE_SWATCH`), so the picker teaches the
 * document's own vocabulary instead of a parallel colour key that exists
 * nowhere else and dies in greyscale (law 3). A "Clear role" ghost sets role
 * null.
 */
export function RolePicker({ value, onSelect }: RolePickerProps) {
  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
        Role
      </p>
      <div className="flex gap-1" role="group" aria-label="Region role">
        {ROLE_OPTIONS.map((opt) => {
          const isActive = value === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={isActive}
              className={`flex-1 gap-1.5 ${isActive ? ACTIVE_CLASS : ""}`}
              onClick={() => onSelect(opt.value)}
            >
              {/* The role, as the shape it will be on the page — not a hue key. */}
              <span className={REGION_ROLE_SWATCH[opt.value]} aria-hidden="true" />
              {REGION_ROLE_LABEL[opt.value]}
            </Button>
          );
        })}
      </div>
      {value !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-pencil"
          onClick={() => onSelect(null)}
        >
          Clear role
        </Button>
      )}
    </div>
  );
}
