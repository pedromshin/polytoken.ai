/**
 * cost-cap-blocked-card.test.tsx — the two copy modes of CostCapBlockedCard
 * (Wave 0.5 review HIGH-1): without a message it keeps the original
 * daily-cost-cap copy byte-identical; with a server-supplied monthly-turns
 * message it renders that message plus the Billing remedy line instead of
 * the admin remedy.
 */
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CostCapBlockedCard } from "../cost-cap-blocked-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const containers: HTMLDivElement[] = [];

async function renderCard(message?: string): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CostCapBlockedCard message={message} />);
  });
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("CostCapBlockedCard", () => {
  it("renders the original daily-cost copy when no message is supplied", async () => {
    const container = await renderCard();
    expect(container.textContent).toContain(
      "This turn would exceed today's cost limit.",
    );
    expect(container.textContent).toContain(
      "Ask an admin to raise the cap in settings",
    );
    expect(container.textContent).not.toContain("Billing");
  });

  it("renders the server message + Billing remedy when supplied (monthly turns cap)", async () => {
    const message =
      "You've used all of this month's included chat turns on the free plan. Upgrade to keep chatting.";
    const container = await renderCard(message);
    expect(container.textContent).toContain(message);
    expect(container.textContent).toContain(
      "See Billing for your plan's allowance.",
    );
    expect(container.textContent).not.toContain("Ask an admin");
    expect(container.textContent).not.toContain("today's cost limit");
  });
});
