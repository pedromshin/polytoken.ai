"use client";

/**
 * turn-cap-notices.ts — the monthlyChatTurns cap's USER-FACING half, extracted
 * from use-conversation-controller.ts (800-line law, Wave 0.6). Three
 * cohesive pieces:
 *
 *   1. The paid-tier over-allowance toast (OVER_ALLOWANCE_TOAST_MESSAGE /
 *      notifyOverAllowanceOnce / useOverAllowanceNotice) — surfaces the
 *      additive `overLimit: true` marker (chat.recordBrowserTurn's return on
 *      the browser locus, the terminal `completed` event's `over_limit` on
 *      the server locus) as ONE warning toast per controller mount, both
 *      paths sharing a single latch.
 *
 *   2. The pre-turn cap block's card presentation (capBlockPresentationFor) —
 *      the { capKind, capMessage, draftText } trio the live pseudo-turn
 *      threads to CostCapBlockedCard: `capKind` is the remedy discriminant,
 *      `capMessage` presentation copy, `draftText` the typed message the
 *      block would otherwise have destroyed.
 *
 *   3. The one-click draft recovery channel (useDraftRestore) — the card's
 *      "Restore draft" affordance requests a restore; the Composer applies
 *      the latest request (seq-keyed so restoring the same text twice still
 *      re-applies after the user cleared it).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CapNotice } from "./use-chat-stream";

/**
 * Over-allowance marker (paid tiers): a PRO/POWER user at/over their finite
 * monthlyChatTurns cap still gets the turn (paid tiers are never
 * hard-blocked; see turn-cap.ts), so this is informational, not an error.
 * Distinct from the FREE-tier cap block, which rejects with FORBIDDEN and is
 * surfaced by the controller's catch-branch toast.error.
 */
export const OVER_ALLOWANCE_TOAST_MESSAGE =
  "You're past this month's included chat turns. See Billing for your plan's allowance.";

/**
 * notifyOverAllowanceOnce — shows the over-allowance toast AT MOST ONCE per
 * controller mount (the ref is the latch): every subsequent over-cap turn in
 * the same session would otherwise re-toast on every send. `navigate` is
 * INJECTED (the repo idiom — save-as-document-action.tsx receives
 * router.push the same way) so the Billing action uses client-side App
 * Router navigation and the function stays unit-testable without a router
 * provider. Mutating `alreadyNotifiedRef.current` is the standard React ref
 * idiom, not shared-data mutation.
 */
export function notifyOverAllowanceOnce(
  overLimit: boolean | undefined,
  alreadyNotifiedRef: { current: boolean },
  navigate: (href: string) => void,
): void {
  if (overLimit !== true || alreadyNotifiedRef.current) return;
  alreadyNotifiedRef.current = true;
  toast.warning(OVER_ALLOWANCE_TOAST_MESSAGE, {
    action: {
      label: "Billing",
      onClick: () => {
        navigate("/billing");
      },
    },
  });
}

/**
 * useOverAllowanceNotice — owns the once-per-mount latch BOTH loci share.
 * The server locus reports via `serverOverLimit` (the terminal `completed`
 * event's over_limit marker, use-chat-stream.ts) — watched by an effect; the
 * browser locus calls the returned notifier imperatively with
 * recordBrowserTurn's `overLimit`. One latch, one toast per mount, no matter
 * which path (or both) reports first.
 */
export function useOverAllowanceNotice(
  serverOverLimit: boolean,
  navigate: (href: string) => void,
): (overLimit: boolean | undefined) => void {
  const latchRef = useRef(false);

  useEffect(() => {
    if (serverOverLimit) {
      notifyOverAllowanceOnce(true, latchRef, navigate);
    }
  }, [serverOverLimit, navigate]);

  return useCallback(
    (overLimit: boolean | undefined) => {
      notifyOverAllowanceOnce(overLimit, latchRef, navigate);
    },
    [navigate],
  );
}

/** One draft-restore request. `seq` makes each request distinct so applying
 * the SAME text twice (user restored, cleared, restored again) still takes
 * effect — the Composer applies a request exactly once, keyed on seq. */
export interface DraftRestoreRequest {
  readonly text: string;
  readonly seq: number;
}

/**
 * useDraftRestore — the controller-owned channel between the cap-block
 * card's "Restore draft" affordance and the (locally-stateful) Composer.
 * The card calls `requestDraftRestore(draftText)`; the views thread
 * `draftRestore` into the Composer, which copies the text into its own
 * field. Empty text is ignored — there is nothing to restore.
 */
export function useDraftRestore(): {
  readonly draftRestore: DraftRestoreRequest | null;
  readonly requestDraftRestore: (text: string) => void;
} {
  const [draftRestore, setDraftRestore] = useState<DraftRestoreRequest | null>(
    null,
  );
  const requestDraftRestore = useCallback((text: string) => {
    if (text.length === 0) return;
    setDraftRestore((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  return { draftRestore, requestDraftRestore };
}

/** The cap-block fields the live pseudo-turn threads to CostCapBlockedCard
 * (via MessageListItem → MessageTurn). All-absent for every state except the
 * pre-turn cap block. */
export interface CapBlockPresentation {
  readonly capKind?: "monthly_chat_turns";
  readonly capMessage?: string;
  readonly draftText?: string;
}

/**
 * capBlockPresentationFor — pure glue: derives the CostCapBlockedCard props
 * for the live streaming pseudo-turn. Only a PRE-TURN block (zero parts,
 * D-21) carries anything: `capKind`/`capMessage` from the stream's CapNotice
 * (a daily-cost block has no notice — the card keeps its byte-identical
 * default copy), and `draftText` from the composer text the block destroyed
 * (null when the blocked turn was not a composer send — a regenerate or
 * widget continuation loses no draft).
 */
export function capBlockPresentationFor(args: {
  readonly isPreTurnCapBlock: boolean;
  readonly capNotice: CapNotice | null;
  readonly lostDraftText: string | null;
}): CapBlockPresentation {
  if (!args.isPreTurnCapBlock) return {};
  return {
    capKind: args.capNotice?.kind,
    capMessage: args.capNotice?.message ?? undefined,
    draftText:
      args.lostDraftText !== null && args.lostDraftText.length > 0
        ? args.lostDraftText
        : undefined,
  };
}
