"use client";

/**
 * pack-switcher.tsx — PackSwitcher (52-02-PLAN.md Task 1 stub / Task 2 TDD
 * target, PANL-01).
 *
 * Task 1 ships an INERT interface-first skeleton (renders the resolved pack
 * as a disabled `Select`, no mutation) purely so `PanelActionsToolbar` has a
 * real component to compose against and typechecks cleanly — pack-switcher.tsx
 * is not in Task 1's own file list (Task 2 owns it), but the toolbar's left
 * slot references it, so a stub is required here first (Rule 3 auto-fix:
 * missing referenced file). Task 2's TDD RED/GREEN cycle replaces this body
 * with the real optimistic-apply/revert-on-error/persist behavior — the
 * exported `PackSwitcherProps` contract is stable across both.
 */

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polytoken/ui/select";
import { STYLE_PACKS, STYLE_PACK_IDS } from "@polytoken/genui/theme";
import type { StylePackId } from "@polytoken/genui/theme";

export interface PackSwitcherProps {
  readonly panelId: string;
  /** The pack `resolveActivePanel` currently resolves for this panel — the
   * seed for this Select's local optimistic value (52-02-PLAN.md Task 2). */
  readonly resolvedPackId: StylePackId;
  readonly isLocked: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}

const TRIGGER_CLASS =
  "h-6 w-28 shrink-0 gap-1 rounded-md border-none bg-transparent px-1.5 text-xs font-normal text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus:ring-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40";

export function PackSwitcher({ resolvedPackId }: PackSwitcherProps): React.ReactElement {
  return (
    <Select value={resolvedPackId} disabled>
      <SelectTrigger aria-label="Style pack" className={TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STYLE_PACK_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {STYLE_PACKS[id].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
