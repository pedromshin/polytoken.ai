/**
 * cost-cap-blocked-card.test.tsx — CostCapBlockedCard's copy modes (Wave 0.5
 * review HIGH-1, reworked Wave 0.6): the remedy line switches on the
 * `capKind` DISCRIMINANT (never on message presence — message is
 * presentation); without a kind the daily-cost-cap copy stays byte-identical.
 * Plus the draft-preservation affordance: the destroyed composer text
 * renders inside the card with a one-click "Restore draft" button.
 */
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CostCapBlockedCard } from "../cost-cap-blocked-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const containers: HTMLDivElement[] = [];

async function renderCard(
  props: React.ComponentProps<typeof CostCapBlockedCard> = {},
): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CostCapBlockedCard {...props} />);
  });
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("CostCapBlockedCard", () => {
  it("renders the original daily-cost copy when no kind/message is supplied", async () => {
    const container = await renderCard();
    expect(container.textContent).toContain(
      "This turn would exceed today's cost limit.",
    );
    expect(container.textContent).toContain(
      "Ask an admin to raise the cap in settings",
    );
    expect(container.textContent).not.toContain("Billing");
  });

  it("renders the server message + Billing remedy for kind 'monthly_chat_turns'", async () => {
    const message =
      "You've used all of this month's included chat turns on the free plan. Upgrade to keep chatting.";
    const container = await renderCard({
      capKind: "monthly_chat_turns",
      message,
    });
    expect(container.textContent).toContain(message);
    expect(container.textContent).toContain(
      "See Billing for your plan's allowance.",
    );
    expect(container.textContent).not.toContain("Ask an admin");
    expect(container.textContent).not.toContain("today's cost limit");
  });

  it("the remedy discriminates on KIND, not message presence — kind without copy still routes to Billing", async () => {
    const container = await renderCard({ capKind: "monthly_chat_turns" });
    expect(container.textContent).toContain(
      "See Billing for your plan's allowance.",
    );
    expect(container.textContent).not.toContain("Ask an admin");
  });

  it("renders the destroyed draft text and restores it in ONE click", async () => {
    const onRestoreDraft = vi.fn();
    const draft = "the exact message I typed\nwith a second line";
    const container = await renderCard({
      capKind: "monthly_chat_turns",
      message: "Cap reached.",
      draftText: draft,
      onRestoreDraft,
    });

    // The user's exact text is visible — never silently destroyed.
    expect(container.textContent).toContain("the exact message I typed");

    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Restore draft",
    );
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
    });
    expect(onRestoreDraft).toHaveBeenCalledTimes(1);
    expect(onRestoreDraft).toHaveBeenCalledWith(draft);
  });

  it("no draftText — no quoted draft and no Restore button (both cap modes stay clean)", async () => {
    const container = await renderCard({ capKind: "monthly_chat_turns" });
    expect(container.textContent).not.toContain("Restore draft");
    const daily = await renderCard({});
    expect(daily.textContent).not.toContain("Restore draft");
  });
});
