/**
 * inbox-row-ingest-capped.test.tsx — vLAUNCH B-lane: the inbox row's quiet
 * treatment for an email whose ingest finalized 'degraded' with the
 * `ingest_cost_capped` reason (the A1 daily cost cap skipped enrichment).
 *
 * Two claims, both jsdom-provable:
 *   1. PRESENT — a capped email shows the quiet marker (chrome, no hue: the
 *      same border-rule/text-pencil register the parse-status marker's quiet
 *      states use), with the shared one-line note surfaced on `title`.
 *   2. ABSENT — every non-capped email renders BYTE-IDENTICAL DOM to a row
 *      that never carried the parse fields at all. The state does not occur
 *      until the cost-cap flag flips, so absence-is-identical IS today's
 *      whole inbox.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  INGEST_COST_CAPPED_MARK,
  INGEST_COST_CAPPED_NOTE,
} from "../../_vocabulary/ingest-degradation";
import { InboxRow, type InboxEmail } from "../inbox-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BASE_EMAIL: InboxEmail = {
  id: "11111111-1111-1111-1111-111111111111",
  subject: "Cotação frete SP -> POA",
  senderName: "Rafael Lima",
  senderAddress: "rafael@example.com",
  receivedAt: "2026-01-01T00:00:00.000Z",
  bodyText: "Consigo fechar em R$ 4.820,00 com coleta na sexta.",
};

const CAPPED_ERROR =
  "ingest_cost_capped: daily ingest cap reached, enrichment skipped";

const containers: HTMLDivElement[] = [];

async function renderRow(email: InboxEmail): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <InboxRow
        email={email}
        entities={[]}
        isSelected={false}
        onSelect={() => undefined}
      />,
    );
  });
  return container;
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("InboxRow — ingest-cost-capped visibility (vLAUNCH B-lane)", () => {
  it("a capped email shows the quiet marker with the shared note on title", async () => {
    const container = await renderRow({
      ...BASE_EMAIL,
      parseStatus: "degraded",
      parseError: CAPPED_ERROR,
    });

    const marker = container.querySelector<HTMLElement>(
      '[data-field="ingest-capped"]',
    );
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toBe(INGEST_COST_CAPPED_MARK);
    expect(marker!.getAttribute("title")).toBe(INGEST_COST_CAPPED_NOTE);

    // Law 1: quiet chrome — the rule/pencil register, never a hue, never
    // the loud ink-border treatment (this is a paused analysis, not a
    // failure demanding attention).
    expect(marker!.className).toContain("border-rule");
    expect(marker!.className).toContain("text-pencil");
    expect(marker!.className).not.toMatch(/madder|destructive|red|amber|verdigris/);
  });

  it("absent state renders byte-identical to a row without the parse fields", async () => {
    // The pre-lane shape: no parseStatus/parseError keys at all.
    const baseline = await renderRow(BASE_EMAIL);

    const nonCapped: ReadonlyArray<InboxEmail> = [
      { ...BASE_EMAIL, parseStatus: "parsed", parseError: null },
      { ...BASE_EMAIL, parseStatus: "received", parseError: null },
      // Degraded for a DIFFERENT reason (adapter degradation) stays quiet on
      // the row — the detail surface already owns that story (ING-6).
      {
        ...BASE_EMAIL,
        parseStatus: "degraded",
        parseError: "adapter_degraded[classifier]: classify failed",
      },
      { ...BASE_EMAIL, parseStatus: "failed", parseError: CAPPED_ERROR },
    ];

    for (const email of nonCapped) {
      const container = await renderRow(email);
      expect(container.innerHTML).toBe(baseline.innerHTML);
      expect(container.querySelector('[data-field="ingest-capped"]')).toBeNull();
    }
  });
});
