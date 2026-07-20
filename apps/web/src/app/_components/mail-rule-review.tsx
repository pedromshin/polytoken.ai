"use client";

// Explicit React import — this file's JSX compiles fine under Next.js's SWC
// automatic JSX runtime, but vitest's plain esbuild transform defaults to
// the classic runtime (React.createElement) and needs `React` in scope
// whenever a test mounts this component (mirrors inbox-row.tsx's identical
// note).
import * as React from "react";

/**
 * MailRuleReview (MAIL-01 UI, D-58-01, taste doc "Email rules review
 * (Lane B)") — the suggest-only rule-review affordance, modeled on HEY's
 * Screener and deliberately NOT a /settings Rules page: proposals surface
 * in-context during triage, right where the matched email is being read.
 *
 * ## Identity notes (why this looks the way it does)
 *
 * - A rule suggestion is PRODUCT-GENERATED chrome, not the user's own
 *   material — so everything here speaks SANS (law 2). That is also why
 *   this component never uses `pmark` (pmark IMPLIES serif — it is the mark
 *   for the document's own words); the dashed/solid tier language is stated
 *   with the `.badge` + swatch pattern instead, exactly like
 *   inbox-entities-rail's tier badge.
 * - The sugg/conf hues are EARNED here (law 1): dashed `--sugg` = machine-
 *   inferred, awaiting a human; solid `--conf` = a human accepted it. The
 *   tier ladder maps 1:1 onto entity resolution's INFERRED-until-blessed
 *   stance — no new vocabulary.
 * - Click economy (taste checklist): accept/dismiss are single clicks on the
 *   suggestion row itself, fire optimistically, and offer Undo inline —
 *   never a confirm modal.
 * - Error state is `border-rule` + `text-ink` (the swept madder treatment) —
 *   madder is reserved for irreversible CONTROLS, and nothing here is one.
 *
 * ## Suggest-only invariant
 *
 * Accepting a suggestion here records the human's blessing in CLIENT state
 * only (the `onDecide` seam below). Nothing executes: the backend matcher
 * (`mail_rules/rules.py`) is suggest-only by construction, and the eventual
 * write path runs through the capability registry's permission model
 * (MAIL-02) — when that mutation lands, it attaches at `onDecide` in
 * InboxThreePane without changing this component.
 */

/**
 * One INFERRED suggestion for an email — the client projection of
 * `emails.ruleSuggestions` (packages/api-client/src/router/emails/
 * rule-suggestions.ts), itself a faithful port of the Python `Suggestion`
 * shape in mail_rules/rules.py. Typed locally so this component never
 * depends on the api-client package (the InboxEmail pattern).
 */
export interface RuleSuggestionEntry {
  readonly ruleId: string;
  readonly capabilityId: string;
  readonly actionArguments: Readonly<Record<string, unknown>>;
  /** Human-readable rationale carried from the rule. */
  readonly describe: string;
  readonly status: "inferred";
  readonly applied: boolean;
}

/** A human's local verdict on one suggestion. Absent = still undecided. */
export type RuleDecision = "accepted" | "dismissed";

/**
 * suggestionActionLabel — render a capability id + its proposed arguments as
 * the one-line action phrase the review row leads with ("Forward to
 * accounting@example.com"). Pure and exported for tests. Unknown capability
 * ids fall back to the raw id — a new backend action degrades to legible,
 * never to a blank row.
 */
export function suggestionActionLabel(
  capabilityId: string,
  actionArguments: Readonly<Record<string, unknown>>,
): string {
  const arg = (key: string): string | null => {
    const value = actionArguments[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  switch (capabilityId) {
    case "suggest_forward_email": {
      const to = arg("to_address");
      return to ? `Forward to ${to}` : "Forward this email";
    }
    case "suggest_apply_label": {
      const label = arg("label");
      return label ? `Label “${label}”` : "Apply a label";
    }
    case "suggest_extract_to_sheet": {
      const sheet = arg("sheet");
      return sheet ? `Extract into “${sheet}”` : "Extract to a sheet";
    }
    default:
      return capabilityId;
  }
}

// ---------------------------------------------------------------------------
// The collapsed row mark — "N rule suggestions" on the inbox row
// ---------------------------------------------------------------------------

interface RuleSuggestionRowMarkProps {
  /** UNDECIDED suggestion count for this email; renders nothing for 0. */
  readonly count: number;
}

/**
 * RuleSuggestionRowMark — the taste doc's "collapsed '3 rule suggestions'
 * chip near the inbox" (Lane B point 1). Non-interactive on purpose:
 * selecting the row is already the one click that opens the review panel in
 * the reading pane, so a second click target here would only split the
 * gesture. Dashed sugg language = INFERRED, awaiting a human.
 */
export function RuleSuggestionRowMark({
  count,
}: RuleSuggestionRowMarkProps): React.ReactElement | null {
  if (count <= 0) return null;

  return (
    <span
      data-field="rule-suggestion-mark"
      className="inline-flex w-fit items-center gap-1 rounded-sm border border-dashed border-sugg-line bg-sugg-wash px-1.5 py-0.5 text-2xs leading-none font-semibold whitespace-nowrap text-sugg"
    >
      <span
        aria-hidden
        className="block size-[7px] rounded-[1.5px] border border-dashed border-sugg"
      />
      {count === 1 ? "1 rule suggestion" : `${count} rule suggestions`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The in-context review panel — lives inside the reading preview
// ---------------------------------------------------------------------------

interface MailRuleReviewPanelProps {
  /** ALL suggestions for the selected email (decided ones included). */
  readonly suggestions: ReadonlyArray<RuleSuggestionEntry>;
  /** Local decisions for this email, keyed by ruleId. */
  readonly decisions: ReadonlyMap<string, RuleDecision>;
  /** The bless/dismiss seam — see the suggest-only note in the header. */
  readonly onDecide: (ruleId: string, decision: RuleDecision) => void;
  /** Clears a decision (undo-over-confirm, taste checklist item 2). */
  readonly onUndo: (ruleId: string) => void;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /**
   * Teaching empty state (taste checklist: "empty states TEACH the next
   * action"). The CALLER sets this only when the rules query resolved and NO
   * email on the visible page matched any rule — a per-email "no
   * suggestions" note on every unmatched email would be noise, but a user
   * who has never seen a suggestion deserves to learn the feature exists
   * and that it will never act on its own.
   */
  readonly showTeaching: boolean;
}

/**
 * MailRuleReviewPanel — the compact review strip rendered between the
 * reading preview's meta line and the body. States:
 *
 * - loading: renders nothing (most emails match no rule; a skeleton strip on
 *   every email would be a hole in the reading rhythm — the panel appears
 *   when it has something true to say).
 * - error: one quiet framed line (border-rule + ink — never madder).
 * - no suggestions + showTeaching: the teaching empty state.
 * - no suggestions otherwise: renders nothing (anti-bloat).
 * - suggestions: one row per suggestion — undecided rows are dashed sugg
 *   (INFERRED) with single-click Accept / Dismiss; an accepted row flips to
 *   the solid conf language (blessed); a dismissed row collapses to a quiet
 *   line. Both decided states carry an inline Undo.
 */
export function MailRuleReviewPanel({
  suggestions,
  decisions,
  onDecide,
  onUndo,
  isLoading,
  isError,
  showTeaching,
}: MailRuleReviewPanelProps): React.ReactElement | null {
  if (isLoading) return null;

  if (isError) {
    return (
      <div
        data-field="rule-review-error"
        role="alert"
        className="mt-3 border border-rule px-3 py-2 text-xs text-ink"
      >
        Couldn&rsquo;t check your mail rules for this email.{" "}
        <span className="text-faded">Reload the page to try again.</span>
      </div>
    );
  }

  if (suggestions.length === 0) {
    if (!showTeaching) return null;
    return (
      <div
        data-field="rule-review-teaching"
        className="mt-3 border border-dashed border-hair px-3 py-2.5"
      >
        <p className="text-xs font-semibold text-ink">
          Rules watch your mail and suggest — never act.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-faded">
          When a rule matches a message — say, a subject containing
          &ldquo;invoice&rdquo; — its suggested action appears right here,
          dashed until you accept it. Nothing is forwarded, labeled, or
          extracted without your say-so.
        </p>
      </div>
    );
  }

  return (
    <section
      data-field="rule-review"
      aria-label="Rule suggestions for this email"
      className="mt-3"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-2xs font-semibold tracking-[0.07em] text-pencil uppercase">
          Suggested by your rules
        </span>
        <span className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded">
          {suggestions.length}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {suggestions.map((suggestion) => {
          const decision = decisions.get(suggestion.ruleId);
          const actionLabel = suggestionActionLabel(
            suggestion.capabilityId,
            suggestion.actionArguments,
          );

          if (decision === "dismissed") {
            // Collapsed, hue-free: a dismissed proposal is spent chrome, not
            // a state worth colour. Undo keeps the decision reversible.
            return (
              <li
                key={suggestion.ruleId}
                data-field="rule-suggestion"
                data-decision="dismissed"
                className="flex items-baseline justify-between gap-3 border border-hair px-3 py-1.5"
              >
                <span className="truncate text-xs text-faded line-through">
                  {actionLabel}
                </span>
                <button
                  type="button"
                  onClick={() => onUndo(suggestion.ruleId)}
                  className="shrink-0 text-xs font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
                >
                  Undo
                </button>
              </li>
            );
          }

          if (decision === "accepted") {
            // Blessed: the dashed sugg language flips to solid conf — the
            // same tier ladder entity resolution speaks, no new vocabulary.
            return (
              <li
                key={suggestion.ruleId}
                data-field="rule-suggestion"
                data-decision="accepted"
                className="flex items-center justify-between gap-3 border border-conf-line bg-conf-wash px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {actionLabel}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-2xs font-semibold text-conf">
                    <span
                      aria-hidden
                      className="block size-[7px] rounded-[1.5px] bg-conf"
                    />
                    Accepted — runs with your permission, never on its own
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onUndo(suggestion.ruleId)}
                  className="shrink-0 text-xs font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
                >
                  Undo
                </button>
              </li>
            );
          }

          // Undecided: INFERRED, dashed — the suggestion states its action,
          // its rationale, and two single-click verdicts. No modal, no form.
          return (
            <li
              key={suggestion.ruleId}
              data-field="rule-suggestion"
              data-decision="undecided"
              className="border border-dashed border-sugg-line bg-sugg-wash px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {actionLabel}
                  </span>
                  {suggestion.describe.length > 0 && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-faded">
                      {suggestion.describe}
                    </span>
                  )}
                </div>
                <span
                  data-field="tier-badge"
                  data-tier="suggested"
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-dashed border-sugg-line px-1.5 py-0.5 text-2xs leading-none font-semibold whitespace-nowrap text-sugg"
                >
                  <span
                    aria-hidden
                    className="block size-[7px] rounded-[1.5px] border border-dashed border-sugg"
                  />
                  Suggested
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onDecide(suggestion.ruleId, "accepted")}
                  className="rounded-sm border border-rule bg-bright px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-shade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 pointer-coarse:min-h-11"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onDecide(suggestion.ruleId, "dismissed")}
                  className="rounded-sm px-2.5 py-1 text-xs font-semibold text-faded transition-colors hover:bg-shade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 pointer-coarse:min-h-11"
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
