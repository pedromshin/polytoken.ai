/**
 * capture-inbox-baseline.test.tsx — 60-01-PLAN.md Task 1: freezes the
 * pre-Phase-60 `InboxThreePane` DOM shape as a committed artifact
 * (`__baselines__/inbox-pre-60.json`) BEFORE any inbox component is edited.
 *
 * This file runs first in Phase 60's history, against the component tree AS
 * IT SHIPPED AT THE END OF PHASE 59 — no component under test here is ever
 * touched by this or any later Phase 60 plan. Plan 02/03's
 * `inbox-structure.test.tsx` mounts the POST-redesign tree against the SAME
 * fixture and asserts its `fingerprintTree` shape differs.
 *
 * Mount + `vi.mock("~/trpc/react")` convention mirrors
 * `inbox-mobile-stack.test.tsx` exactly. The fixture additionally gives
 * `entitySummary.useQuery` a NON-EMPTY result (in the CURRENT, pre-60
 * `EntityChipEntry` shape: entityTypeId/label/count/entityInstanceId) so the
 * baseline captures the chip subtree too — a baseline with no chips would
 * understate the pre-60 structure and unfairly flatter the redesign.
 *
 * Artifact-safety: the capture only WRITES when `CAPTURE_STRUCTURE_BASELINE`
 * is `"1"` (`describe.skipIf` — a normal `vitest run` neither writes nor
 * fails) AND only when `__baselines__/inbox-pre-60.json` does not already
 * exist. If it exists, the capture throws rather than silently overwriting —
 * a post-60 rewrite of this artifact would make the delta gate it feeds
 * vacuous. A separate always-on test asserts the committed baseline exists,
 * parses, and is non-empty, so a missing artifact is loud, not silent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const EMAIL_1_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL_2_ID = "22222222-2222-2222-2222-222222222222";
const TYPE_SUPPLIER_ID = "33333333-3333-3333-3333-333333333333";
const TYPE_AMOUNT_ID = "44444444-4444-4444-4444-444444444444";
const INSTANCE_ID = "55555555-5555-5555-5555-555555555555";

const FAKE_EMAILS = [
  {
    id: EMAIL_1_ID,
    subject: "Cotação frete SP -> POA",
    senderName: "Rafael Lima",
    senderAddress: "rafael@example.com",
    receivedAt: "2026-01-01T00:00:00.000Z",
    bodyText: "Consigo fechar em R$ 4.820,00 com coleta na sexta.",
    toAddresses: ["me@example.com"],
  },
  {
    id: EMAIL_2_ID,
    subject: "Invoice #42",
    senderName: null,
    senderAddress: "billing@example.com",
    receivedAt: "2026-01-02T00:00:00.000Z",
    bodyText: null,
    toAddresses: [] as string[],
  },
];

const FAKE_THREADS = [
  {
    key: "t1",
    threadId: null,
    importerId: "imp-1",
    subject: "Cotação frete SP -> POA",
    messageCount: 1,
    latestReceivedAt: "2026-01-01T00:00:00.000Z",
    latestSnippet: "Consigo fechar em R$ 4.820,00 com coleta na sexta.",
    memberEmailIds: [EMAIL_1_ID],
  },
  {
    key: "t2",
    threadId: null,
    importerId: "imp-1",
    subject: "Invoice #42",
    messageCount: 1,
    latestReceivedAt: "2026-01-02T00:00:00.000Z",
    latestSnippet: null,
    memberEmailIds: [EMAIL_2_ID],
  },
];

// Pre-60 EntityChipEntry shape (entityTypeId/label/count/entityInstanceId) —
// the shape entity-chips.tsx accepted before this plan's Task 3 rewrite.
const FAKE_ENTITY_SUMMARY = [
  {
    emailId: EMAIL_1_ID,
    entities: [
      {
        entityTypeId: TYPE_SUPPLIER_ID,
        label: "Supplier",
        count: 2,
        entityInstanceId: INSTANCE_ID,
      },
      { entityTypeId: TYPE_AMOUNT_ID, label: "Amount", count: 1 },
    ],
  },
  { emailId: EMAIL_2_ID, entities: [] },
];

vi.mock("~/trpc/react", () => ({
  api: {
    emails: {
      list: {
        useQuery: () => ({
          data: { items: FAKE_EMAILS },
          isLoading: false,
          isError: false,
        }),
      },
      entitySummary: {
        useQuery: () => ({
          data: FAKE_ENTITY_SUMMARY,
          isLoading: false,
          isError: false,
        }),
      },
      // MAIL-01: the rule-suggestion seam — empty result, resolved (keeps
      // the captured baseline free of suggestion rows).
      ruleSuggestions: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          isSuccess: true,
        }),
      },
      listThreads: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          refetch: vi.fn().mockResolvedValue({ data: undefined }),
        }),
      },
    },
  },
}));

import { InboxThreePane, type InboxData } from "../inbox-three-pane";
import { fingerprintTree } from "../../__tests__/support/structural-fingerprint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.join(__dirname, "__baselines__");
const BASELINE_PATH = path.join(BASELINE_DIR, "inbox-pre-60.json");

const FAKE_DATA: InboxData = {
  items: FAKE_THREADS,
  hasMore: false,
  nextOffset: 2,
};

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

describe.skipIf(process.env.CAPTURE_STRUCTURE_BASELINE !== "1")(
  "capture-inbox-baseline (writes the frozen pre-60 artifact — CAPTURE_STRUCTURE_BASELINE=1 only)",
  () => {
    it("writes __baselines__/inbox-pre-60.json from the CURRENT InboxThreePane, once", async () => {
      if (existsSync(BASELINE_PATH)) {
        throw new Error(
          `${BASELINE_PATH} already exists. The pre-Phase-60 baseline is FROZEN and must never ` +
            "be regenerated — a post-60 rewrite would make the structural delta gate it feeds " +
            "vacuous. Delete the stray regeneration attempt; if the baseline is genuinely wrong, " +
            "that is a decision for a human, not this capture script.",
        );
      }

      const container = await mount(
        <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
      );

      const fingerprint = fingerprintTree(container);

      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(BASELINE_PATH, `${JSON.stringify(fingerprint, null, 2)}\n`, "utf-8");

      // eslint-disable-next-line no-console -- deliberate one-time capture output
      console.log(
        `Captured inbox-pre-60.json: elements=${fingerprint.elementCount} ` +
          `leafText=${fingerprint.leafTextCount} depth=${fingerprint.maxDepth}`,
      );

      expect(existsSync(BASELINE_PATH)).toBe(true);
    });
  },
);

describe("inbox-pre-60.json (the committed, frozen artifact)", () => {
  it("exists, parses, and has a non-empty shape + elementCount > 0", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);

    const raw = readFileSync(BASELINE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    expect(parsed).toMatchObject({
      shape: expect.any(String),
      elementCount: expect.any(Number),
      maxDepth: expect.any(Number),
      leafTextCount: expect.any(Number),
    });

    const baseline = parsed as { shape: string; elementCount: number; leafTextCount: number };
    expect(baseline.shape.length).toBeGreaterThan(0);
    expect(baseline.elementCount).toBeGreaterThan(0);
    expect(baseline.leafTextCount).toBeGreaterThan(0);
  });
});
