/**
 * emails.ruleSuggestions — the READ-ONLY data seam for MAIL-01's suggest-only
 * mail-rule review UI (the HEY-Screener-style in-context affordance, taste
 * doc "Email rules review (Lane B)").
 *
 * This is a faithful TypeScript projection of the Python matcher in
 * `apps/email-listener/app/application/use_cases/mail_rules/rules.py`
 * (`RuleCondition` / `Rule` / `Suggestion` / `RulesMatcher` /
 * `default_mail_rules`). Keep the two in sync — the Python module is the
 * source of truth for the rule set and the suggest-only invariant; this file
 * only re-derives the same INFERRED suggestions for emails already visible in
 * the web inbox, so the UI can put them on screen without a cross-service
 * hop. When the listener starts persisting matched suggestions (or exposing
 * them over its own API), this procedure's QUERY body is the one place to
 * swap the source; the response shape below is already the Python
 * `Suggestion` shape and should not need to change.
 *
 * ## Suggest-only invariant (mirrors rules.py verbatim)
 *
 * The matcher NEVER applies an action. Every emitted suggestion is INFERRED
 * (`status: "inferred"`, `applied: false`) — dashed until a human blesses it.
 * There is deliberately NO mutation procedure in this file: accepting a
 * suggestion executes downstream through the capability registry's
 * permission model (MAIL-02), never through this read seam.
 *
 * Tenancy (TENA-03): protectedProcedure + userOwnedImporterIds scoping,
 * byte-for-byte the entitySummary pattern — a foreign emailId slipped into
 * the batch matches no owned row and yields an empty suggestions[] entry,
 * never another user's mail metadata.
 *
 * T-05-01: input ids validated as UUIDs before any SQL.
 * DoS: batch capped at 100 ids (same bound as entitySummary); matching runs
 * over subject/sender only — the body is never fetched.
 */

import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { Emails } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// Types — the Python `Suggestion` shape, camelCased
// ---------------------------------------------------------------------------

/**
 * The only status this module can produce (rules.py `SuggestionStatus`).
 * There is deliberately no "applied" / "confirmed" status here.
 */
export type RuleSuggestionStatus = "inferred";

/** Capability ids — mirror capabilities.py's stable resolution keys. */
export const SUGGEST_FORWARD_EMAIL_CAPABILITY_ID = "suggest_forward_email";
export const SUGGEST_APPLY_LABEL_CAPABILITY_ID = "suggest_apply_label";
export const SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID = "suggest_extract_to_sheet";

export interface RuleSuggestion {
  readonly ruleId: string;
  readonly capabilityId: string;
  readonly actionArguments: Readonly<Record<string, unknown>>;
  /** Human-readable rationale carried from the rule (rules.py `describe`). */
  readonly describe: string;
  readonly status: RuleSuggestionStatus;
  /** Fixed false — the matcher provides no path to set it true. */
  readonly applied: false;
}

export interface EmailRuleSuggestions {
  readonly emailId: string;
  readonly suggestions: ReadonlyArray<RuleSuggestion>;
}

/** rules.py `RuleCondition` — a conjunction of optional predicates (AND). */
export interface MailRuleCondition {
  readonly senderContains?: string;
  readonly subjectContains?: string;
  readonly hasLabel?: string;
}

/** rules.py `Rule` — one matcher predicate + the suggested action it emits. */
export interface MailRule {
  readonly id: string;
  readonly condition: MailRuleCondition;
  readonly capabilityId: string;
  readonly actionArguments: Readonly<Record<string, unknown>>;
  readonly describe: string;
}

/** The narrow email projection matching needs — never the body. */
export interface MatchableEmail {
  readonly senderAddress: string | null;
  readonly subject: string | null;
}

// ---------------------------------------------------------------------------
// Pure matcher — exported for DB-free unit testing (aggregateEntitySummary
// pattern). Mirrors RuleCondition.matches / RulesMatcher.match exactly.
// ---------------------------------------------------------------------------

/**
 * A condition with NO predicates set matches nothing — fail-closed, so an
 * empty rule can never blanket-suggest across the whole corpus (rules.py
 * `is_empty`). All matching is case-insensitive.
 */
export function ruleConditionMatches(
  condition: MailRuleCondition,
  email: MatchableEmail,
  labels: ReadonlySet<string> = new Set(),
): boolean {
  const isEmpty =
    condition.senderContains === undefined &&
    condition.subjectContains === undefined &&
    condition.hasLabel === undefined;
  if (isEmpty) return false; // fail-closed: no predicates => no match

  if (condition.senderContains !== undefined) {
    const sender = (email.senderAddress ?? "").toLowerCase();
    if (!sender.includes(condition.senderContains.toLowerCase())) return false;
  }

  if (condition.subjectContains !== undefined) {
    const subject = (email.subject ?? "").toLowerCase();
    if (!subject.includes(condition.subjectContains.toLowerCase())) return false;
  }

  if (condition.hasLabel !== undefined) {
    const wanted = condition.hasLabel.toLowerCase();
    let found = false;
    for (const label of labels) {
      if (label.toLowerCase() === wanted) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
}

/**
 * Return one INFERRED `RuleSuggestion` per rule whose condition matches, in
 * rule order. Applies nothing — every returned suggestion is
 * `status: "inferred"` / `applied: false` (rules.py `RulesMatcher.match`).
 *
 * The web inbox carries no label projection yet, so `labels` defaults empty —
 * a `hasLabel` rule simply does not match here until labels reach this
 * surface (honest under-suggestion, never over-suggestion).
 */
export function matchMailRules(
  email: MatchableEmail,
  rules: ReadonlyArray<MailRule> = DEFAULT_MAIL_RULES,
  labels: ReadonlySet<string> = new Set(),
): ReadonlyArray<RuleSuggestion> {
  return rules
    .filter((rule) => ruleConditionMatches(rule.condition, email, labels))
    .map((rule) => ({
      ruleId: rule.id,
      capabilityId: rule.capabilityId,
      actionArguments: { ...rule.actionArguments },
      describe: rule.describe,
      status: "inferred" as const,
      applied: false as const,
    }));
}

/**
 * The fixture rule set — a 1:1 port of rules.py `default_mail_rules()`.
 * Deliberately tiny and deterministic, covering all three suggest actions.
 */
export const DEFAULT_MAIL_RULES: ReadonlyArray<MailRule> = [
  {
    id: "forward-invoices-to-accounting",
    condition: { subjectContains: "invoice" },
    capabilityId: SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
    actionArguments: { to_address: "accounting@example.com", note: "Invoice for review" },
    describe: "Invoices should be forwarded to accounting for review.",
  },
  {
    id: "label-newsletters",
    condition: { senderContains: "newsletter@" },
    capabilityId: SUGGEST_APPLY_LABEL_CAPABILITY_ID,
    actionArguments: { label: "Newsletters" },
    describe: "Mail from newsletter senders belongs under the Newsletters label.",
  },
  {
    id: "extract-receipts-to-sheet",
    condition: { subjectContains: "receipt", hasLabel: "expenses" },
    capabilityId: SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
    actionArguments: { sheet: "Expenses 2026", fields: ["vendor", "amount", "date"] },
    describe: "Receipts tagged as expenses should be extracted into the expenses sheet.",
  },
];

// ---------------------------------------------------------------------------
// Procedure — spread into emailsRouter
// ---------------------------------------------------------------------------

export const emailRuleSuggestionProcedures = {
  /**
   * ruleSuggestions — batch, read-only rule-match over the visible page of
   * email ids. Returns one entry per requested id, in requested order (empty
   * suggestions for emails no rule matches). Never writes; never executes.
   */
  ruleSuggestions: protectedProcedure
    .input(
      z.object({
        emailIds: z.array(z.string().uuid()).max(100),
      }),
    )
    .query(async ({ ctx, input }): Promise<ReadonlyArray<EmailRuleSuggestions>> => {
      const empty = (): ReadonlyArray<EmailRuleSuggestions> =>
        input.emailIds.map((emailId) => ({ emailId, suggestions: [] }));

      if (input.emailIds.length === 0) return [];

      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      if (owned.length === 0) return empty();

      // Narrow projection: matching reads sender + subject only — the body is
      // never fetched. Ownership scoping mirrors entitySummary: both inArray
      // filters are parameterized Drizzle builders (T-05-03), and a foreign
      // emailId simply resolves to no row.
      const rows = await ctx.db
        .select({
          id: Emails.id,
          subject: Emails.subject,
          senderAddress: Emails.senderAddress,
        })
        .from(Emails)
        .where(
          and(
            inArray(Emails.id, input.emailIds),
            inArray(Emails.importerId, owned),
          ),
        );

      const byId = new Map(rows.map((row) => [row.id, row]));

      return input.emailIds.map((emailId) => {
        const email = byId.get(emailId);
        return {
          emailId,
          suggestions: email ? matchMailRules(email) : [],
        };
      });
    }),
};
