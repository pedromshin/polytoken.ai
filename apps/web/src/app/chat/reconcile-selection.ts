/**
 * reconcile-selection.ts — the pure decision behind ChatPage's stale-selection
 * safety net (task #4, criterion c). Extracted from the page effect so it is
 * unit-testable without mounting the full tRPC page (mirrors
 * resolveDefaultModelId / groupTurnsFromHistory's "pure helper, exported for
 * render-free testing" convention).
 *
 * A selected conversation that vanishes from the list — hard-deleted in another
 * tab, or an id no longer accessible to this user — must NEVER strand the main
 * column on a permanent "Loading conversation…" screen. This decides where to
 * fall back: the newest-available conversation, or the empty state (a fresh
 * chat) when none remain.
 *
 * The `seenIds` guard is load-bearing: createConversation / duplicate set the
 * selection to a brand-new id BEFORE the invalidated listConversations refetch
 * includes it, so that id is legitimately absent for one render. Only an id
 * that was PREVIOUSLY present in a loaded list and later disappeared counts as
 * stale — a never-seen id is treated as a pending create and left alone.
 */

export interface ReconcileSelectionArgs {
  /** The currently-selected conversation id, or null (empty state). */
  readonly selectedId: string | null;
  /** Ids from the latest listConversations result, or undefined while the
   * query has not resolved yet. */
  readonly conversationIds: readonly string[] | undefined;
  /** Ids the page has observed in any prior loaded list (see the guard note). */
  readonly seenIds: ReadonlySet<string>;
}

export interface ReconcileSelectionResult {
  /** The id to select instead — the newest-available conversation, or null to
   * fall back to the empty state (a fresh chat). */
  readonly nextSelectedId: string | null;
}

/**
 * reconcileSelectedConversation — returns a reconciliation action when the
 * current selection is stale, or null meaning "leave the selection as-is".
 */
export function reconcileSelectedConversation(
  args: ReconcileSelectionArgs,
): ReconcileSelectionResult | null {
  const { selectedId, conversationIds, seenIds } = args;
  // List not loaded yet — nothing to reconcile against.
  if (conversationIds === undefined) return null;
  // Nothing selected — the empty state is already correct.
  if (selectedId === null) return null;
  // The selection still exists — keep it.
  if (conversationIds.includes(selectedId)) return null;
  // Absent but never seen in a loaded list — a freshly-created id awaiting the
  // refetch; do NOT bounce away from it.
  if (!seenIds.has(selectedId)) return null;
  // Absent and previously seen — it vanished. Fall back to newest-available,
  // or the empty state when none remain.
  return { nextSelectedId: conversationIds[0] ?? null };
}
