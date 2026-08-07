"use client";

/**
 * turn-cap-notices.ts — the monthlyChatTurns cap's USER-FACING half, extracted
 * from use-conversation-controller.ts (800-line law, Wave 0.6). Five
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
 *
 *   4. The browser-locus block toast (notifyBrowserTurnCapBlocked, W7-4) —
 *      chat.recordBrowserTurn's FORBIDDEN rejection has no block card (the
 *      turn already RENDERED locally; only persistence was refused), so the
 *      error toast itself carries the one-click "Restore draft" action,
 *      feeding the same restore channel as the card.
 *
 *   5. The blocked-draft durability slot (useBlockedDraftHolder, W7-4) —
 *      SINGLE-SLOT holder for the draft the current pre-turn block
 *      destroyed, so the card's Restore keeps working while the card is
 *      visible even after a later action clears the controller's
 *      pending-draft ref. Single slot BY DESIGN: the next block's draft
 *      replaces the held one, and an unclaimed draft is dropped with only a
 *      console.warn — no draft history is kept.
 *
 *   6. The approaching-cap upsell notice (W8-1) — approachingCapNoticeFor +
 *      useUpsellBannerDismissal. The pure derivation behind UpsellBanner
 *      (the ONE upgrade prompt outside /billing): a finite-tier caller at
 *      >= 80% of their monthlyChatTurns entitlement gets a quiet single-line
 *      notice above the composer. Numbers come from entitlementsFor — never
 *      hardcoded — so a tier's allowance raise moves the threshold for free.
 *      The dismiss latch is MODULE-scoped (session), not per-mount: the
 *      keyed ConversationView remounts on every conversation switch, and a
 *      per-mount latch would resurrect a banner the user just closed.
 *
 * KNOWN LIMITATION (follow-up, W7-4 item 3): a past_due/canceled PRO user is
 * enforcement-narrowed to `free` (A11 — turn-cap.ts entitledTierFrom,
 * tier_resolver.py), so when blocked at the free cap they get the free-tier
 * "upgrade" copy even though their real remedy is fixing payment. Neither
 * the `cost_capped` stream event (breached_cap + message only — see
 * capNoticeFromEvent in use-chat-stream.ts) nor recordBrowserTurn's
 * FORBIDDEN error carries a subscription-status discriminant today, so the
 * client CANNOT tell the two cases apart. Copy nuance here first requires
 * the listener/gate to emit a status field — a listener-contract change,
 * deliberately out of scope for this module.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { entitlementsFor, type Tier } from "@polytoken/billing";

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

/**
 * notifyBrowserTurnCapBlocked — the browser locus' free-tier cap rejection
 * (chat.recordBrowserTurn throwing FORBIDDEN). No block card exists on this
 * path — the turn already rendered locally and only persistence was refused —
 * so the error toast carries the same one-click "Restore draft" affordance
 * the server-path card offers, feeding the same channel (useDraftRestore).
 * The streamed reply is NOT recoverable (the cap gate refused to persist it,
 * by design); only the user's typed text is. Empty draft text drops the
 * action — there is nothing to restore.
 */
export function notifyBrowserTurnCapBlocked(
  message: string,
  draftText: string,
  requestDraftRestore: (text: string) => void,
): void {
  toast.error(
    message,
    draftText.length > 0
      ? {
          action: {
            label: "Restore draft",
            onClick: () => {
              requestDraftRestore(draftText);
            },
          },
        }
      : undefined,
  );
}

/**
 * useBlockedDraftHolder — SINGLE-SLOT durability holder for the composer
 * draft a pre-turn cap block destroyed (W7-4 hardening). Before this hook
 * the live block card read the controller's MUTABLE pending-draft ref at
 * render time, making the card the sole holder of the destroyed text: a
 * regenerate or widget submit issued while the card was still visible
 * cleared that ref and silently stranded the card's "Restore draft".
 *
 * SINGLE-SLOT SEMANTICS (by design — no draft history):
 *   - The slot captures the pending draft ONCE, on the render where the
 *     block appears, and holds it while the card is visible — later
 *     mutations of the pending ref cannot take it away.
 *   - When the card leaves (the next send / regenerate / widget submit /
 *     retry), the slot empties. An unclaimed draft is then gone for good:
 *     log-only (console.warn) — recovering it would need a history this
 *     module deliberately does not keep. The next block's draft REPLACES
 *     the slot, never queues behind it.
 *   - `noteDraftRestored` marks the held draft claimed (the card's Restore
 *     ran) so the normal restore-then-resend flow drops silently.
 */
export function useBlockedDraftHolder(
  isPreTurnCapBlock: boolean,
  pendingDraft: string | null,
): {
  readonly heldDraft: string | null;
  readonly noteDraftRestored: (text: string) => void;
} {
  const [held, setHeld] = useState<string | null>(null);
  // Effect-time mirror of the slot; `restored` marks the draft claimed.
  const slotRef = useRef<{ draft: string | null; restored: boolean }>({
    draft: null,
    restored: false,
  });
  const prevBlockRef = useRef(false);

  useEffect(() => {
    if (isPreTurnCapBlock && !prevBlockRef.current) {
      // Block landing — capture. The pending ref is still intact on this
      // render: the blocked send wrote it and nothing else has run yet.
      slotRef.current = { draft: pendingDraft, restored: false };
      setHeld(pendingDraft);
    } else if (!isPreTurnCapBlock && prevBlockRef.current) {
      if (slotRef.current.draft !== null && !slotRef.current.restored) {
        // Single slot: the unclaimed draft is dropped for good — log-only.
        console.warn(
          "[turn-cap-notices] blocked draft dropped without restore " +
            `(single-slot holder, ${slotRef.current.draft.length} chars)`,
        );
      }
      slotRef.current = { draft: null, restored: false };
      setHeld(null);
    }
    prevBlockRef.current = isPreTurnCapBlock;
  }, [isPreTurnCapBlock, pendingDraft]);

  const noteDraftRestored = useCallback((text: string) => {
    if (slotRef.current.draft === text) {
      slotRef.current = { ...slotRef.current, restored: true };
    }
  }, []);

  // First-frame passthrough: the capture effect runs only after the commit,
  // but the card's very first render must already offer the draft — on that
  // render the pending ref is still intact, so fall through to it.
  return {
    heldDraft: isPreTurnCapBlock ? (held ?? pendingDraft) : null,
    noteDraftRestored,
  };
}

/**
 * Fraction of a FINITE monthlyChatTurns entitlement at which the
 * approaching-cap banner appears (UpsellBanner): 0.8 = "you've used 80% of
 * this month's included turns".
 */
export const APPROACHING_CAP_FRACTION = 0.8;

/** The two numbers the banner reads out: consumption and the tier's cap. */
export interface ApproachingCapNotice {
  readonly used: number;
  readonly cap: number;
}

/**
 * approachingCapNoticeFor — pure derivation behind UpsellBanner (W8-1).
 * Returns `{ used, cap }` only when the caller's tier has a FINITE
 * monthlyChatTurns entitlement (read via entitlementsFor — never a number
 * hardcoded here) AND usage has reached APPROACHING_CAP_FRACTION of it.
 * `null` everywhere else:
 *   - an unlimited tier (power: monthlyChatTurns null) NEVER sees the banner
 *     — there is nothing to sell past;
 *   - absent tier/usage (query loading, errored, or data missing) fails
 *     quiet, per the banner's contract.
 * An unknown tier string falls back to `free` inside entitlementsFor, which
 * is also the enforcement gate's reading (turn-cap.ts) — the banner can
 * never promise more than the gate grants.
 */
export function approachingCapNoticeFor(args: {
  readonly tier: Tier | undefined;
  readonly monthlyChatTurnsUsed: number | undefined;
}): ApproachingCapNotice | null {
  if (args.tier === undefined || args.monthlyChatTurnsUsed === undefined) {
    return null;
  }
  const cap = entitlementsFor(args.tier).monthlyChatTurns;
  if (cap === null) return null;
  if (args.monthlyChatTurnsUsed < cap * APPROACHING_CAP_FRACTION) return null;
  return { used: args.monthlyChatTurnsUsed, cap };
}

/**
 * The banner-dismiss latch — the once-per-mount ref idiom above
 * (notifyOverAllowanceOnce) hoisted ONE level, because module scope IS the
 * session on a client bundle: ConversationView is keyed by conversationId,
 * so a per-mount latch would resurrect the banner on every conversation
 * switch right after the user closed it. Mutating `.current` is the same
 * blessed ref-shaped mutation the per-mount latches use, not shared-data
 * mutation of app state.
 */
const upsellBannerDismissLatch = { current: false };

/** TEST-ONLY reset — module state outlives each test's mounts. Production
 * code must never call this: the whole point is that the latch survives. */
export function resetUpsellBannerDismissalForTests(): void {
  upsellBannerDismissLatch.current = false;
}

/**
 * useUpsellBannerDismissal — the session dismiss latch as React state. A
 * fresh mount seeds from the module latch (an already-dismissed session
 * never re-shows), and `dismiss` writes both the latch and the local state
 * so the current mount hides immediately.
 */
export function useUpsellBannerDismissal(): {
  readonly dismissed: boolean;
  readonly dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState(upsellBannerDismissLatch.current);
  const dismiss = useCallback(() => {
    upsellBannerDismissLatch.current = true;
    setDismissed(true);
  }, []);
  return { dismissed, dismiss };
}
