/**
 * rule-suggestions-matching.test.ts — unit tests for the pure mail-rule
 * matcher port in rule-suggestions.ts (MAIL-01 UI seam). DB-free, same
 * testability pattern as aggregateEntitySummary.
 *
 * The port must stay faithful to the Python source of truth
 * (apps/email-listener/app/application/use_cases/mail_rules/rules.py); these
 * tests pin the behaviours that module documents as invariants:
 *
 *   Test 1: an empty condition matches NOTHING (fail-closed — an empty rule
 *           can never blanket-suggest across the corpus).
 *   Test 2: predicates are a conjunction (AND) and case-insensitive.
 *   Test 3: hasLabel requires the label; the web surface passes no labels,
 *           so a label-gated rule honestly under-suggests (never over-).
 *   Test 4: match() emits one suggestion per matching rule, in rule order,
 *           every one `status: "inferred"` / `applied: false` — the
 *           suggest-only invariant, machine-checked.
 *   Test 5: the default fixture rules fire on their intended fixtures.
 *   Test 6: actionArguments are copied, never shared with the rule object.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAIL_RULES,
  matchMailRules,
  ruleConditionMatches,
  type MailRule,
} from "../rule-suggestions";

const email = (subject: string | null, senderAddress: string | null) => ({
  subject,
  senderAddress,
});

describe("ruleConditionMatches", () => {
  it("Test 1: an empty condition matches nothing (fail-closed)", () => {
    expect(ruleConditionMatches({}, email("Invoice #42", "a@b.com"))).toBe(false);
  });

  it("Test 2: predicates AND together and match case-insensitively", () => {
    const condition = { subjectContains: "INVOICE", senderContains: "billing@" };
    expect(
      ruleConditionMatches(condition, email("Your invoice is ready", "Billing@acme.com")),
    ).toBe(true);
    // subject matches, sender does not => whole condition fails (AND)
    expect(
      ruleConditionMatches(condition, email("Your invoice is ready", "news@acme.com")),
    ).toBe(false);
    // null fields never match a set predicate
    expect(ruleConditionMatches(condition, email(null, null))).toBe(false);
  });

  it("Test 3: hasLabel requires the label (empty label set => no match)", () => {
    const condition = { subjectContains: "receipt", hasLabel: "expenses" };
    const receipt = email("Receipt for March", "shop@x.com");
    expect(ruleConditionMatches(condition, receipt)).toBe(false);
    expect(ruleConditionMatches(condition, receipt, new Set(["Expenses"]))).toBe(true);
  });
});

describe("matchMailRules", () => {
  const rules: ReadonlyArray<MailRule> = [
    {
      id: "r1",
      condition: { subjectContains: "invoice" },
      capabilityId: "suggest_forward_email",
      actionArguments: { to_address: "acc@x.com" },
      describe: "d1",
    },
    {
      id: "r2",
      condition: { senderContains: "@x.com" },
      capabilityId: "suggest_apply_label",
      actionArguments: { label: "X" },
      describe: "d2",
    },
  ];

  it("Test 4: emits inferred/unapplied suggestions in rule order", () => {
    const suggestions = matchMailRules(email("invoice 9", "team@x.com"), rules);
    expect(suggestions.map((s) => s.ruleId)).toEqual(["r1", "r2"]);
    for (const suggestion of suggestions) {
      expect(suggestion.status).toBe("inferred");
      expect(suggestion.applied).toBe(false);
    }
  });

  it("Test 5: the default fixture rules fire on their intended fixtures", () => {
    const invoice = matchMailRules(email("Invoice #77", "vendor@corp.com"));
    expect(invoice.map((s) => s.ruleId)).toEqual(["forward-invoices-to-accounting"]);

    const newsletter = matchMailRules(email("Weekly digest", "newsletter@site.com"));
    expect(newsletter.map((s) => s.ruleId)).toEqual(["label-newsletters"]);

    // receipt rule is label-gated and the web surface passes no labels
    expect(matchMailRules(email("Receipt for lunch", "shop@x.com"))).toEqual([]);

    expect(matchMailRules(email("hello", "friend@home.net"))).toEqual([]);
    expect(DEFAULT_MAIL_RULES).toHaveLength(3);
  });

  it("Test 6: actionArguments are copied, never shared with the rule", () => {
    const [suggestion] = matchMailRules(email("invoice 9", "a@b.com"), rules);
    expect(suggestion?.actionArguments).toEqual({ to_address: "acc@x.com" });
    expect(suggestion?.actionArguments).not.toBe(rules[0]?.actionArguments);
  });
});
