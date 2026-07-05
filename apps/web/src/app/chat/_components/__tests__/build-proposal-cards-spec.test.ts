/**
 * build-proposal-cards-spec.test.ts — buildProposalCardsSpec unit tests
 * (Task 2, 24-03, D-05/D-09).
 */

import { describe, expect, it } from "vitest";

import { SpecRootSchema } from "@nauta/genui/schema";

import {
  buildProposalCardsSpec,
  PROPOSAL_CHOICE_ACTION_KEY,
  type ProposalCardsDeclaration,
} from "../build-proposal-cards-spec";

const DECLARATION: ProposalCardsDeclaration = {
  prompt: "Which plan do you want?",
  options: [
    { id: "opt-0", title: "Ship next week", description: "Fast, higher risk" },
    { id: "opt-1", title: "Ship next month" },
  ],
};

describe("buildProposalCardsSpec", () => {
  it("produces a SpecRootSchema-valid spec", () => {
    const spec = buildProposalCardsSpec(DECLARATION);
    const result = SpecRootSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it("emits one stack child per option, each a card with a footer button", () => {
    const spec = buildProposalCardsSpec(DECLARATION) as unknown as {
      root: { type: string; children: unknown[] };
    };
    expect(spec.root.type).toBe("stack");
    expect(spec.root.children).toHaveLength(2);
  });

  it("every button's aria-label equals '<label> — <title>'", () => {
    const spec = buildProposalCardsSpec(DECLARATION) as unknown as {
      root: {
        children: Array<{
          title: string;
          footer: { label: string; "aria-label": string };
        }>;
      };
    };
    for (const card of spec.root.children) {
      expect(card.footer["aria-label"]).toBe(`${card.footer.label} — ${card.title}`);
    }
  });

  it("falls back to 'Choose this option' when no per-option label is supplied", () => {
    const spec = buildProposalCardsSpec(DECLARATION) as unknown as {
      root: { children: Array<{ footer: { label: string } }> };
    };
    for (const card of spec.root.children) {
      expect(card.footer.label).toBe("Choose this option");
    }
  });

  it("uses a per-option label when the declaration supplies one", () => {
    const declaration: ProposalCardsDeclaration = {
      options: [{ id: "opt-0", title: "Ship next week", label: "Ship it" }],
    };
    const spec = buildProposalCardsSpec(declaration) as unknown as {
      root: { children: Array<{ footer: { label: string; "aria-label": string } }> };
    };
    expect(spec.root.children[0]?.footer.label).toBe("Ship it");
    expect(spec.root.children[0]?.footer["aria-label"]).toBe("Ship it — Ship next week");
  });

  it("each footer button's onClick carries the option's id as a setState value under PROPOSAL_CHOICE_ACTION_KEY", () => {
    const spec = buildProposalCardsSpec(DECLARATION) as unknown as {
      root: {
        children: Array<{
          footer: { onClick: { type: string; key: string; value: string } };
        }>;
      };
    };
    expect(spec.root.children[0]?.footer.onClick).toEqual({
      type: "setState",
      key: PROPOSAL_CHOICE_ACTION_KEY,
      value: "opt-0",
    });
    expect(spec.root.children[1]?.footer.onClick.value).toBe("opt-1");
  });

  it("omits description when the option has none", () => {
    const spec = buildProposalCardsSpec(DECLARATION) as unknown as {
      root: { children: Array<{ description?: string }> };
    };
    expect(spec.root.children[1]?.description).toBeUndefined();
  });
});
