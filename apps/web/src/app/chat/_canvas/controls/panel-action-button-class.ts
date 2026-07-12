/**
 * panel-action-button-class.ts — the shared `size-6` icon-button class every
 * panel-toolbar action control (edit/regenerate/re-theme/history) applies to
 * its trigger element (52-UI-SPEC.md Component 1's shared icon-button
 * recipe — mirrors `KnowledgePreviewNode`'s existing remove-button class
 * with a neutral hover instead of destructive hover, 52-02-PLAN.md Task 1).
 *
 * Lives in its own module (not `panel-actions-toolbar.tsx`) so the toolbar
 * can import the four control components AND those control components can
 * import this class without a circular dependency — a deviation from the
 * plan's own file list (Rule 3: auto-fixed blocking issue), documented in
 * 52-02-SUMMARY.md. ONE exported constant so Plans 52-03/52-04/52-06's real
 * implementations reuse the exact same string instead of each re-deriving
 * it (grep-verified single source, mirrors the `ProvenanceLink` precedent).
 */

export const PANEL_ACTION_ICON_BUTTON_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-40 disabled:pointer-events-none";
