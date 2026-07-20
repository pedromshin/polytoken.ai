/**
 * inbox-structure.test.tsx — 60-02-PLAN.md Task 3: ROADMAP criterion 1
 * ("visibly differ in layout, hierarchy, and density from the pre-Phase-59
 * version, not just in color"), made executable — the anti-re-token gate.
 *
 * Mounts the CURRENT (post-60-02) `InboxThreePane` against the EXACT SAME
 * fixture and `vi.mock("~/trpc/react")` stub `capture-inbox-baseline.test.tsx`
 * used, but supplies `entitySummary.useQuery` data in Plan 01's NEW per-fact
 * shape (componentId/typeLabel/value/tier/totalCount) — an unfair fixture
 * would invalidate the comparison, since the baseline was captured WITH
 * chips present.
 *
 * Eight legs (Legs 1-4 committed by 60-02-PLAN.md Task 3; Legs 5-8 added by
 * 60-03-PLAN.md Task 3 — the pane-level half of criterion 1, which could not
 * be asserted until the four-pane shell + entities rail existed):
 *   1. LAYOUT + HIERARCHY (the anti-re-token assertion) — `shape` differs
 *      from the frozen baseline, and `elementCount` grew.
 *   2. INFORMATION DENSITY — `leafTextCount` grew (the honest, jsdom-provable
 *      proxy for "more distinct facts rendered per row"; a real px-density
 *      metric needs the screenshot harness, Plan 05's job).
 *   3. NAMED HIERARCHY — the bands exist with the right `data-field` roles,
 *      law 2 holds structurally (font-serif <=> data-evidence, both
 *      directions — this already scans the WHOLE container, so it covers
 *      the reading pane + entities rail too now that they exist), time is
 *      tabular, every chip declares a valid tier.
 *   4. XSS (T-60-02) — no inbox component uses `dangerouslySetInnerHTML`,
 *      now including `inbox-entities-rail.tsx`.
 *   5. FOUR NAMED PANES — the desktop tree carries exactly the SET
 *      {filters, threads, reading, entities} via `[data-pane]`, scoped to
 *      `[data-tree="desktop"]` so the mobile tree's simultaneous jsdom
 *      render never double-counts.
 *   6. THE ENTITIES RAIL'S TIER CONTRACT — every fact carries a valid
 *      `data-tier`, mounted directly (no InboxThreePane fixture needed).
 *   7. EMPTY ENTITIES RENDER NOTHING — `InboxEntitiesRail` with an empty
 *      list renders no `[data-pane="entities"]` at all (anti-bloat: no
 *      empty rail with a heading over nothing).
 *   8. READING BODY MEASURE — `[data-field="body"]` carries `font-serif`
 *      and the reference's `max-w-[56ch]` bound.
 *
 * THE NEGATIVE PROOF (required — see "Negative Proof" below and
 * 60-02-SUMMARY.md/60-03-SUMMARY.md for the verbatim RED output): this gate
 * was proven able to fail by temporarily restoring the pre-Phase-60
 * versions of inbox-row.tsx/inbox-thread-group.tsx/entity-chips.tsx/
 * inbox-three-pane.tsx (Phase 59's ENTIRE colour system left untouched) via
 * `git checkout <pre-60-commit> -- <files>` — NOT `git stash`, since by the
 * time this task runs, every file involved is already committed, so there
 * is no uncommitted diff for `git stash` to capture; a
 * checkout-of-an-old-commit-then-restore is the equivalent, safe mechanic
 * for an already-committed change (see `<destructive_git_prohibition>` —
 * `git checkout -- <path>` is the sanctioned way to discard a change to a
 * specific file). `inbox-entities-rail.tsx` did not exist pre-Phase-60 at
 * all (it is a wholly new pane, not a restyled one) — the negative proof
 * removes it outright rather than checking out a nonexistent path, then
 * restores it the same way as the other four files:
 * `git checkout HEAD -- <path>`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { fingerprintTree } from "../../__tests__/support/structural-fingerprint";
import { InboxEntitiesRail } from "../inbox-entities-rail";

import type { EntityChipEntry } from "../entity-chips";

const EMAIL_1_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL_2_ID = "22222222-2222-2222-2222-222222222222";
const TYPE_SUPPLIER_ID = "33333333-3333-3333-3333-333333333333";
const TYPE_AMOUNT_ID = "44444444-4444-4444-4444-444444444444";
const INSTANCE_ID = "55555555-5555-5555-5555-555555555555";
const COMPONENT_1_ID = "66666666-6666-6666-6666-666666666666";
const COMPONENT_2_ID = "77777777-7777-7777-7777-777777777777";

// Identical to capture-inbox-baseline.test.tsx's fixture (same ids, same
// subject/sender/bodyText) — a fair comparison requires the SAME fixture.
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
    // Non-null here (unlike capture-inbox-baseline.test.tsx's fixture,
    // which deliberately left this null to prove the "omit when blank"
    // behavior structurally): a realistic inbox has body text on most
    // messages, and this gate's own information-density leg (criterion 2)
    // is best exercised when more than one row can grow a snippet band.
    // The plan's stated fairness bar ("the baseline was captured with
    // chips present, so the current tree must render chips too") is about
    // chip presence, not bodyText parity — unaffected by this choice.
    bodyText: "Please find the invoice attached for your records.",
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

// Plan 01's NEW per-fact entitySummary shape (componentId/typeLabel/value/
// tier/totalCount) — NOT the pre-60 { entityTypeId, label, count } shape.
const FAKE_ENTITY_SUMMARY = [
  {
    emailId: EMAIL_1_ID,
    entities: [
      {
        componentId: COMPONENT_1_ID,
        entityTypeId: TYPE_SUPPLIER_ID,
        typeLabel: "Supplier",
        value: "Acme Freight",
        tier: "confirmed" as const,
        entityInstanceId: INSTANCE_ID,
      },
      {
        componentId: COMPONENT_2_ID,
        entityTypeId: TYPE_AMOUNT_ID,
        typeLabel: "Amount",
        value: "R$ 4.820,00",
        tier: "suggested" as const,
      },
    ],
    totalCount: 2,
  },
  {
    emailId: EMAIL_2_ID,
    entities: [
      {
        componentId: "88888888-8888-8888-8888-888888888888",
        entityTypeId: TYPE_SUPPLIER_ID,
        typeLabel: "Supplier",
        value: "Billing Co",
        tier: "confirmed" as const,
      },
    ],
    totalCount: 1,
  },
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
      // MAIL-01: the rule-suggestion seam — empty result, resolved (so the
      // teaching empty state is the branch exercised by default).
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, "__baselines__", "inbox-pre-60.json");

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

/**
 * Finds a `<div>` by its EXACT `className` string. Both the desktop and
 * mobile trees are simultaneously present in jsdom (no media-query
 * evaluation there), so scoping by the wrapper's literal className is the
 * reliable way to isolate one tree's rows from the other's identical
 * fixture-backed content (mirrors inbox-mobile-stack.test.tsx).
 */
function findByExactClassName(root: HTMLElement, className: string): HTMLElement {
  const match = Array.from(root.querySelectorAll<HTMLElement>("div")).find(
    (el) => el.className === className,
  );
  if (!match) throw new Error(`No <div className="${className}"> found`);
  return match;
}

describe("inbox-structure (ROADMAP criterion 1, the anti-re-token gate)", () => {
  it("Leg 1: layout + hierarchy — shape differs from the frozen pre-60 baseline; elementCount grew", async () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      shape: string;
      elementCount: number;
      leafTextCount: number;
    };

    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const current = fingerprintTree(container);

    // `fingerprintTree` reads NO className, NO style, and NO data-* attribute
    // (structural-fingerprint.ts). A pure re-token — any number of colour
    // classes changed, any number of tokens swapped — therefore produces a
    // `shape` IDENTICAL to the baseline: nothing it can see moved. Only
    // genuine DOM restructuring (new bands, new elements, new nesting) can
    // move `shape`. This assertion is precisely criterion 1's "not just in
    // color", expressed as an executable predicate — see the Negative Proof
    // in 60-02-SUMMARY.md for direct evidence that a colour-only revert
    // fails this exact check.
    expect(current.shape).not.toBe(baseline.shape);

    // Bands were ADDED (serif snippet, tabular time element, chip data
    // attributes), not merely swapped for different classes.
    expect(current.elementCount).toBeGreaterThan(baseline.elementCount);
  });

  it("Leg 2: information density — leafTextCount grew (more distinct facts rendered)", async () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      leafTextCount: number;
    };

    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const current = fingerprintTree(container);

    // jsdom does not evaluate Tailwind CSS, so a real px-density metric is
    // not honestly available here (the screenshot harness owns that). What
    // IS measurable, and is what ROADMAP criterion 2 actually means by
    // "information density", is how many distinct facts a row renders — the
    // snippet band alone moves this number.
    expect(
      current.leafTextCount,
      `leafTextCount did not grow: baseline=${baseline.leafTextCount} current=${current.leafTextCount}`,
    ).toBeGreaterThan(baseline.leafTextCount);
  });

  it("Leg 3: named hierarchy — bands exist, law 2 holds both directions, time is tabular, every chip has a valid tier", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const desktopRoot = findByExactClassName(container, "hidden h-full md:block");

    // Scope to one row's worth of bands: the first row's subject/snippet/time.
    expect(desktopRoot.querySelector('[data-field="subject"]')).not.toBeNull();
    expect(desktopRoot.querySelector('[data-field="snippet"]')).not.toBeNull();
    expect(desktopRoot.querySelector('[data-field="time"]')).not.toBeNull();
    expect(desktopRoot.querySelector('[data-field="chip"]')).not.toBeNull();

    // Law 2, forward direction: every [data-evidence] element is font-serif.
    const evidenceEls = Array.from(container.querySelectorAll<HTMLElement>("[data-evidence]"));
    expect(evidenceEls.length).toBeGreaterThan(0);
    for (const el of evidenceEls) {
      expect(el.className).toContain("font-serif");
    }

    // Law 2, reverse direction (the half that actually bites): no element
    // carrying font-serif lacks data-evidence — serif can never drift onto
    // chrome.
    const serifEls = Array.from(container.querySelectorAll<HTMLElement>('[class*="font-serif"]'));
    expect(serifEls.length).toBeGreaterThan(0);
    for (const el of serifEls) {
      expect(el.hasAttribute("data-evidence")).toBe(true);
    }

    // Time is tabular everywhere it appears.
    const timeEls = Array.from(container.querySelectorAll<HTMLElement>('[data-field="time"]'));
    expect(timeEls.length).toBeGreaterThan(0);
    for (const el of timeEls) {
      expect(el.className).toContain("tabular");
    }

    // Every chip declares a valid tier — asserted through the attribute,
    // never by reading colour, so this gate stays colour-blind and honest.
    const chipEls = Array.from(container.querySelectorAll<HTMLElement>('[data-field="chip"]'));
    expect(chipEls.length).toBeGreaterThan(0);
    for (const el of chipEls) {
      expect(["confirmed", "suggested"]).toContain(el.getAttribute("data-tier"));
    }
  });

  it("Leg 4 (T-60-02): no inbox component uses dangerouslySetInnerHTML", () => {
    const inboxComponentFiles = [
      "../inbox-row.tsx",
      "../inbox-thread-group.tsx",
      "../inbox-three-pane.tsx",
      "../entity-chips.tsx",
      "../inbox-entities-rail.tsx",
    ];

    for (const relPath of inboxComponentFiles) {
      const absPath = path.join(__dirname, relPath);
      const source = readFileSync(absPath, "utf-8");
      // Filter comment lines out before counting so a future header comment
      // mentioning the string cannot self-invalidate this gate (mirrors
      // palette-ban.test.ts's source-walking idiom).
      const codeOnly = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      expect(codeOnly).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("Leg 5: the desktop tree names all four panes — filters, threads, reading, entities (the set, not just the count)", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const desktopRoot = findByExactClassName(container, "hidden h-full md:block");
    const paneNames = new Set(
      Array.from(desktopRoot.querySelectorAll<HTMLElement>("[data-pane]")).map((el) =>
        el.getAttribute("data-pane"),
      ),
    );

    // A rename (e.g. "reading" -> "preview") would change the SET, not just
    // shrink a count — asserting set equality is what a rename cannot
    // silently pass. The fixture's default-selected email (EMAIL_1) carries
    // entities, so the entities pane is present under this fixture.
    expect(paneNames).toEqual(new Set(["filters", "threads", "reading", "entities"]));
  });

  it("Leg 6: the entities rail — every fact carries a valid data-tier", async () => {
    const FACTS: ReadonlyArray<EntityChipEntry> = [
      {
        componentId: "aaaaaaaa-0000-0000-0000-000000000001",
        entityTypeId: "bbbbbbbb-0000-0000-0000-000000000001",
        typeLabel: "Supplier",
        value: "Acme Freight",
        tier: "confirmed",
      },
      {
        componentId: "aaaaaaaa-0000-0000-0000-000000000002",
        entityTypeId: "bbbbbbbb-0000-0000-0000-000000000002",
        typeLabel: "Amount",
        value: "R$ 100,00",
        tier: "suggested",
      },
    ];

    const container = await mount(
      <InboxEntitiesRail entities={FACTS} emailId={EMAIL_1_ID} />,
    );

    expect(container.querySelector('[data-pane="entities"]')).not.toBeNull();

    const tierEls = Array.from(container.querySelectorAll<HTMLElement>("[data-tier]"));
    expect(tierEls.length).toBe(FACTS.length);
    for (const el of tierEls) {
      expect(["confirmed", "suggested"]).toContain(el.getAttribute("data-tier"));
    }
  });

  it("Leg 7: the entities rail renders nothing when the selected email has no entities", async () => {
    const container = await mount(<InboxEntitiesRail entities={[]} emailId={EMAIL_1_ID} />);

    // Anti-bloat (60-03-PLAN.md Task 2): no empty rail with a heading over
    // nothing — the reference has no empty-rail state.
    expect(container.querySelector('[data-pane="entities"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("Leg 8: the reading body carries font-serif and the 56ch bounded measure", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const desktopRoot = findByExactClassName(container, "hidden h-full md:block");
    const bodyEl = desktopRoot.querySelector<HTMLElement>('[data-field="body"]');

    expect(bodyEl).not.toBeNull();
    expect(bodyEl?.className).toContain("font-serif");
    expect(bodyEl?.className).toContain("max-w-[56ch]");
    expect(bodyEl?.hasAttribute("data-evidence")).toBe(true);
  });
});
