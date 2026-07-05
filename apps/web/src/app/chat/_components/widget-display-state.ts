/**
 * widget-display-state.ts — deriveWidgetDisplayState: pure derivation of a
 * widget interaction's client-visible display state (Task 3, 24-03,
 * D-02/D-11/D-12).
 *
 * Colocated with components (not a hook) so it needs no hook mounting to
 * test. The `chat_widget_interactions.state` DB column only ever transitions
 * pending -> submitted server-side (the CAS lock, D-11) — "superseded" and
 * "stale" are NEVER written to that column; both are computed REACTIVELY
 * client-side (D-12) from the SAME turn/sibling-version state Phase-22's
 * regenerate feature already tracks, plus an optimistic local "typing
 * supersedes" set (D-02). A local in-flight submit overlays "submitting" on
 * top of whatever the row would otherwise resolve to (a submitted row can
 * never be in-flight, so the ordering below is safe).
 */

import type { ChatHistoryRow } from "../_hooks/use-conversation-controller";

export type WidgetDisplayState = "pending" | "submitting" | "submitted" | "superseded" | "stale";

/** Mirrors `chat.getWidgetInteractions`' selected columns. */
export interface WidgetInteractionRow {
  readonly id: string;
  readonly messageId: string;
  readonly partIndex: number;
  readonly widgetKind: string;
  readonly state: string;
  readonly submittedValue: unknown;
}

export interface DeriveWidgetDisplayStateArgs {
  readonly interaction: WidgetInteractionRow;
  readonly historyRows: readonly ChatHistoryRow[];
  /** Interaction ids the user has locally (optimistically) superseded by
   * typing a new message while this widget was pending (D-02) — set BEFORE
   * the send request even starts. */
  readonly supersededLocally: ReadonlySet<string>;
  /** The interaction id currently mid-submit (the composer's `handleWidgetSubmit`
   * is awaiting the server), or null. */
  readonly inFlightInteractionId: string | null;
}

/**
 * A pending widget is stale when its emitting message is no longer the
 * ACTIVE sibling (a regenerate switched the active version) OR a strictly
 * newer turn exists in the conversation (D-12) — mirrors
 * `is_stale`'s server-side check (24-01), computed here proactively so the
 * badge can appear before any submit is even attempted.
 */
function isStaleByTurnState(
  interaction: WidgetInteractionRow,
  historyRows: readonly ChatHistoryRow[],
): boolean {
  const emittingRow = historyRows.find((row) => row.id === interaction.messageId);
  if (emittingRow === undefined) {
    // The emitting message isn't in the currently-loaded history at all —
    // treat conservatively as NOT stale (no evidence either way) rather than
    // false-flagging every widget before history has loaded.
    return false;
  }
  if (!emittingRow.isActive) {
    return true;
  }
  return historyRows.some((row) => row.turnIndex > emittingRow.turnIndex);
}

export function deriveWidgetDisplayState({
  interaction,
  historyRows,
  supersededLocally,
  inFlightInteractionId,
}: DeriveWidgetDisplayStateArgs): WidgetDisplayState {
  if (interaction.state === "submitted") {
    return "submitted";
  }
  if (inFlightInteractionId === interaction.id) {
    return "submitting";
  }
  if (supersededLocally.has(interaction.id)) {
    return "superseded";
  }
  if (isStaleByTurnState(interaction, historyRows)) {
    return "stale";
  }
  return "pending";
}
