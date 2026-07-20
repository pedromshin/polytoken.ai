/**
 * canvas-node-law.test.tsx — 61-06-PLAN.md Task 3. The identity's laws made
 * executable over the RENDERED canvas node shells and the wire.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE DIVISION OF LABOUR — read this before adding an assertion here
 * ────────────────────────────────────────────────────────────────────────
 *
 * `canvas-vocabulary.test.ts` (61-02) gates the MAPS: that
 * `CANVAS_EDGE_TIER`/`CANVAS_NODE_KIND_GEOMETRY` say the right thing, and that
 * they agree with the shared truth in `_vocabulary/tier.ts`.
 *
 * THIS gate covers what the COMPONENTS actually render with them. A correct map
 * wired into a component that ignores it is exactly the failure neither gate can
 * see alone — and it is not hypothetical: point `GenuiPanelNode` at
 * `CANVAS_NODE_KIND_GEOMETRY.chat` and 61-02's map gate stays fully green while
 * two node kinds become indistinguishable on screen. "Kind is legible, rendered"
 * below is the assertion that catches it (negative proof 2 in 61-06-SUMMARY.md
 * ran exactly that mis-wire).
 *
 * So: facts about the vocabulary go THERE. Facts about the DOM go here. Do not
 * duplicate — a second copy of an assertion is a second thing to drift.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE MADDER ASSERTION IS A PROXY, NOT A PROOF. A GREEN RUN HERE DOES NOT
 * MEAN LAW 1 HOLDS ON THIS SURFACE.
 * ────────────────────────────────────────────────────────────────────────
 *
 * "No madder text or border in the rendered classes" is the closest a
 * DOM-reading gate can get to "madder marks only the irreversible", and it is
 * not that rule. Its blind spot is real and has been paid for twice:
 * `pdf-preview-pane.tsx` shipped `<Badge variant="destructive">Preview
 * failed</Badge>` — a STATUS talking in the irreversible colour, through the
 * `variant` door this gate deliberately leaves open for genuine reject/deny
 * buttons. It passed every gate. **A human found it by reading.** 61-06 then
 * found a fourth violation on this very surface (the thread card's error icon)
 * the same way, after its own plan's objective had named only three.
 *
 * If you add a control here, READ it against law 1. Do not let this file's
 * green tell you the surface is clean.
 *
 * ────────────────────────────────────────────────────────────────────────
 * BOTH BANNED FAMILIES ARE ASSEMBLED FROM PARTS, NEVER WRITTEN OUT
 * ────────────────────────────────────────────────────────────────────────
 *
 * Plan 61-08 appends `chat/` to `role-hue-ban.test.ts`'s `SCOPED_DIRS`. That
 * walk does NOT exclude `__tests__/` (its `EXCLUDED_DIR_SEGMENTS` is only
 * {dev, node_modules, .next}), so this file falls inside the scope the moment
 * the ratchet turns on. A literal `text-<madder>` here — even inside an
 * assertion proving its ABSENCE — would make that gate execute itself and go
 * red on its own test suite. The retired role family survives a bare mention
 * (that gate requires a colour-utility prefix) but the madder token does not:
 * `text-<madder>` in an assertion is indistinguishable, to a line-reading grep,
 * from `text-<madder>` on an element. Hence: parts, both of them.
 *
 * ────────────────────────────────────────────────────────────────────────
 * MOUNT CONVENTION — copied, not invented
 * ────────────────────────────────────────────────────────────────────────
 *
 * createRoot-in-jsdom + `act`, mirroring `knowledge-preview-node.test.tsx` /
 * `genui-panel-node-toolbar.test.tsx`. `~/trpc/react` is mocked as plain
 * `vi.fn()`s (every shell fetches its own data); `@xyflow/react` is mocked via a
 * PARTIAL factory so `Handle`/`Position`/`BaseEdge`/every other real export
 * stays intact; `sonner` is mocked (mirrors `regenerate-control.test.tsx`).
 * The explicit `import * as React` is load-bearing: the shells' own headers
 * record that vitest's esbuild transform defaults to the CLASSIC JSX runtime and
 * needs `React` in scope.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { EdgeProps, NodeProps } from "@xyflow/react";

// ── mocks ────────────────────────────────────────────────────────────────

const threadCardQuery = {
  data: {
    subject: "Q3 renewal quote",
    participantsSummary: "Example Sender, you · 2 messages",
    latestSnippet: "Attached is the renewal quote for Q3. Total: $1,180.00.",
    latestMessageId: "00000000-0000-0000-0000-0000000000e1",
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const expandNodeQuery = {
  data: { nodes: [{ id: "k-1", label: "Acme Corp" }], edges: [] },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (cb: (t: Record<string, never>) => unknown[]) => {
      cb({} as Record<string, never>);
      return [];
    },
    chat: {
      listConversations: { useQuery: () => ({ data: [] }) },
      getHistory: { useQuery: () => ({ data: [] }) },
      createConversation: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      attachConversationToThread: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    emails: { threadCard: { useQuery: () => threadCardQuery } },
    knowledge: { expandNode: { useQuery: () => expandNodeQuery } },
    genui: {
      applyPanelEdit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      generate: { useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }) },
      resolveRetheme: { useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }) },
    },
  },
}));

/**
 * PARTIAL factory — `Handle`/`Position`/`BaseEdge` and every other real export
 * stay intact (mirrors knowledge-preview-node.test.tsx).
 *
 * `EdgeLabelRenderer` is the one exception, and it is mocked to a pass-through
 * for a mechanical reason rather than a convenience one: the real component
 * portals its children into `.react-flow__edgelabel-renderer`, a node that only
 * exists inside a mounted `<ReactFlow>`'s own DOM, and it returns null when that
 * node is absent. Rendering `DataEdge` without it would silently assert nothing
 * — the "label is never hover-gated" test would pass on an empty tree, which is
 * the vacuity failure 61-05 caught in its own gate. Pass-through means these
 * assertions read DataEdge's OWN output; React Flow's portal machinery is the
 * library's to test.
 */
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  // `vi.mock` factories are hoisted above every import, so this closure cannot
  // reach the module-scope `React` binding — hence importActual, and
  // createElement rather than JSX.
  const R = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useReactFlow: () => ({ deleteElements: vi.fn() }),
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* jsdom does not implement this — no-op polyfill for Radix. */
  };
}

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import { CanvasPersistenceProvider } from "../panel-overlay-context";
import { CanvasSpecProvider } from "../canvas-spec-context";
import {
  CANVAS_EDGE_TIER,
  CANVAS_EDGE_TIER_STYLE,
  CANVAS_NODE_KIND_GEOMETRY,
} from "../canvas-vocabulary";
import { ChatControllerProvider, ChatNode } from "../chat-node";
import { DataEdge } from "../data-edge";
import { EmailThreadNode } from "../email-thread-node";
import { GenuiPanelNode } from "../genui-panel-node";
import { KnowledgePreviewNode } from "../knowledge-preview-node";
import { SourceNode } from "../source-node";
import { UnknownNodeTypePlaceholder } from "../unknown-node-type-placeholder";
import type { ConversationController } from "../../_hooks/use-conversation-controller";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── the two banned families, assembled (see header) ───────────────────────

const RETIRED_NODE_TYPE_FAMILY = ["gra", "ph"].join("");
const MADDER_TOKEN = ["destruc", "tive"].join("");

/** A colour-bearing prefix + the retired family — the family actually PAINTING. */
const RETIRED_FAMILY_PATTERN = new RegExp(
  `\\b(?:bg|text|border|border-[lrtxy]|ring|fill|stroke|outline|decoration|divide|from|via|to|accent|shadow)-${RETIRED_NODE_TYPE_FAMILY}-`,
);

/** Madder as a STATE: text or border. The fill/variant door stays open (proxy). */
const STATE_MADDER_PATTERN = new RegExp(
  `\\b(?:text|border)-${MADDER_TOKEN}\\b(?!-foreground)`,
);

/** A tier claim. An edge or a node kind may never make one structurally. */
const TIER_TOKEN_PATTERN = /conf|sugg/;

// ── fixtures ─────────────────────────────────────────────────────────────

const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
const FOCUS_NODE_ID = "00000000-0000-0000-0000-000000000001";
const MESSAGE_ID = "00000000-0000-0000-0000-0000000000b2";
const SOURCE_LEDGER_ID = "22222222-2222-2222-2222-222222222222";

const PROVENANCE: Provenance = { messageId: MESSAGE_ID, partIndex: 0, runId: null };
const SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: "Hello panel" } });

const FAKE_CONTROLLER = {
  turns: [],
  streamingTurnId: "",
  activeStreamState: "idle",
  regenerateDisabled: false,
  liveAnnouncement: "",
  historyRows: [],
  regeneratingMessageId: null,
  handleSubmit: () => undefined,
  handleStop: () => undefined,
  handleRegenerate: () => undefined,
  handleLiveRetry: () => undefined,
  handleNavigateSibling: () => undefined,
  handleSelectBrowserModel: async () => undefined,
  onRegenerateTurn: () => undefined,
  widgets: {
    states: {},
    submittedValues: {},
    errorMessages: {},
    onSubmitResult: () => undefined,
  },
} as unknown as ConversationController;

function nodeProps<T>(overrides: Record<string, unknown>): NodeProps<T extends never ? never : never> {
  return {
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...overrides,
  } as never;
}

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
});

/** The shells, each inside the minimal provider tree it needs. (`document`
 * is the one registered type NOT mounted here — its shell fetches via
 * `api.documents.byId`, which this file's trpc mock does not model; its map
 * facts are still covered by 61-02's vocabulary gate.) */
const SHELLS = {
  chat: (selected: boolean) => (
    <ReactFlowProvider>
      <ChatControllerProvider controller={FAKE_CONTROLLER}>
        <ChatNode
          {...nodeProps({
            id: "chat:1",
            type: "chat",
            data: { conversationId: CONVERSATION_ID },
            selected,
          })}
        />
      </ChatControllerProvider>
    </ReactFlowProvider>
  ),
  "genui-panel": (selected: boolean) => (
    <ReactFlowProvider>
      <CanvasStoreProvider store={createCanvasStore()}>
        <CanvasPersistenceProvider value={{ conversationId: CONVERSATION_ID, scheduleSave: () => undefined }}>
          <CanvasSpecProvider
            specsByProvenance={new Map([[`${MESSAGE_ID}:0`, SPEC_JSON]])}
            partsByProvenance={new Map()}
          >
            <GenuiPanelNode
              {...nodeProps({
                id: "genui-panel:1",
                type: "genui-panel",
                data: { provenance: PROVENANCE, turnIndex: 2 },
                selected,
              })}
            />
          </CanvasSpecProvider>
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>
    </ReactFlowProvider>
  ),
  "email-thread": (selected: boolean) => (
    <ReactFlowProvider>
      <CanvasPersistenceProvider value={{ conversationId: CONVERSATION_ID, scheduleSave: () => undefined }}>
        <EmailThreadNode
          {...nodeProps({
            id: "email-thread:1",
            type: "email-thread",
            data: { threadId: THREAD_ID },
            selected,
          })}
        />
      </CanvasPersistenceProvider>
    </ReactFlowProvider>
  ),
  "knowledge-preview": (selected: boolean) => (
    <ReactFlowProvider>
      <KnowledgePreviewNode
        {...nodeProps({
          id: "knowledge-preview:1",
          type: "knowledge-preview",
          data: { focusNodeId: FOCUS_NODE_ID },
          selected,
        })}
      />
    </ReactFlowProvider>
  ),
  source: (selected: boolean) => (
    <ReactFlowProvider>
      <SourceNode
        {...nodeProps({
          id: `source:${SOURCE_LEDGER_ID}`,
          type: "source",
          data: {
            sourceLedgerId: SOURCE_LEDGER_ID,
            url: "https://www.example.com/research/q3-pricing",
            title: "Q3 pricing benchmarks for renewals",
            excerpt: "Median renewal uplift across the sampled contracts was 4.1%.",
            tier: "suggested",
          },
          selected,
        })}
      />
    </ReactFlowProvider>
  ),
  unknown: (selected: boolean) => (
    <ReactFlowProvider>
      <UnknownNodeTypePlaceholder
        {...nodeProps({
          id: "unknown:1",
          type: "unknown-node-type",
          data: { nodeType: "legacy-widget" },
          selected,
        })}
      />
    </ReactFlowProvider>
  ),
} as const;

type ShellKind = keyof typeof SHELLS;

/** The shells React Flow mounts for a REGISTERED node type. */
const REAL_KINDS: readonly ShellKind[] = [
  "chat",
  "genui-panel",
  "email-thread",
  "knowledge-preview",
  "source",
];
const ALL_KINDS: readonly ShellKind[] = [...REAL_KINDS, "unknown"];

async function renderShell(kind: ShellKind, selected = false): Promise<HTMLElement> {
  const container = await mount(SHELLS[kind](selected));
  const root = container.firstElementChild as HTMLElement | null;
  if (!root) throw new Error(`${kind} shell rendered nothing`);
  return root;
}

/** Every class on every element of a rendered tree, root included. */
function allClasses(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (el: Element): void => {
    const cls = el.getAttribute("class");
    if (cls) out.push(cls);
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return out;
}

function classSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function symmetricDiff(a: Set<string>, b: Set<string>): string[] {
  return [
    ...Array.from(a).filter((c) => !b.has(c)),
    ...Array.from(b).filter((c) => !a.has(c)),
  ];
}

async function renderEdge(): Promise<HTMLDivElement> {
  const props = {
    id: "e1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: "right",
    targetPosition: "left",
    data: { sourcePath: "thread", targetKey: "context" },
    markerEnd: "url(#m)",
  } as unknown as EdgeProps;
  return mount(
    <ReactFlowProvider>
      <svg>
        <DataEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

// ── the gate ─────────────────────────────────────────────────────────────

describe("canvas node law — the RENDERED shells (D-58-01 laws 1/2/3)", () => {
  describe("NO RETIRED FAMILY — the node-type hue is gone from the canvas", () => {
    for (const kind of ALL_KINDS) {
      it(`${kind}: no rendered class paints the retired node-type family`, async () => {
        const root = await renderShell(kind);
        for (const cls of allClasses(root)) {
          expect(cls, `${kind} rendered "${cls}"`).not.toMatch(RETIRED_FAMILY_PATTERN);
        }
      });
    }
  });

  describe("NO MADDER ON A STATE — a PROXY, not a proof (see the file header)", () => {
    for (const kind of ALL_KINDS) {
      it(`${kind}: no rendered class carries a madder text or border token`, async () => {
        const root = await renderShell(kind);
        for (const cls of allClasses(root)) {
          expect(cls, `${kind} rendered "${cls}"`).not.toMatch(STATE_MADDER_PATTERN);
        }
      });
    }

    // The three violations 61-06 cleared, named explicitly: a gate that does
    // not name the thing it fixed lets it back in.

    it("the unknown placeholder does not frame itself in the irreversible colour", async () => {
      // It framed itself that way from 23-UI-SPEC until 61-06. An unrecognized
      // node type is a STATE — nothing has happened, so nothing can be undone.
      const root = await renderShell("unknown");
      expect(root.className).not.toMatch(STATE_MADDER_PATTERN);
      // T-61-18: and it must still VISIBLY account for the node the user saved.
      expect(root.textContent).toContain("legacy-widget");
    });

    for (const kind of ["email-thread", "knowledge-preview", "source"] as const) {
      it(`${kind}'s remove control is ink — removing a card from a board is not irreversible (T-61-19)`, async () => {
        const root = await renderShell(kind);
        const remove = Array.from(root.querySelectorAll("button")).find((b) =>
          (b.getAttribute("aria-label") ?? "").startsWith("Remove"),
        );
        expect(remove, `${kind} renders no Remove control`).toBeDefined();
        expect(remove!.className).not.toMatch(STATE_MADDER_PATTERN);
      });
    }
  });

  describe('ZERO SHADOW — "flat surfaces, hairline rules, zero shadow anywhere"', () => {
    for (const kind of ALL_KINDS) {
      for (const selected of [false, true]) {
        it(`${kind} (selected=${selected}): the root carries no elevation shadow`, async () => {
          const root = await renderShell(kind, selected);
          expect(root.className).not.toMatch(/\bshadow-elevation-/);
        });
      }
    }
  });

  describe("SELECTION IS INK — law 1: selected states carry NO hue", () => {
    for (const kind of REAL_KINDS) {
      it(`${kind}: the selected-vs-unselected class difference names no tier hue`, async () => {
        const off = classSet((await renderShell(kind, false)).className);
        const on = classSet((await renderShell(kind, true)).className);
        const diff = symmetricDiff(off, on);
        expect(diff.length, `${kind} shows no selection at all`).toBeGreaterThan(0);
        for (const cls of diff) {
          expect(cls, `${kind} selection-only class "${cls}"`).not.toMatch(TIER_TOKEN_PATTERN);
          expect(cls, `${kind} selection-only class "${cls}"`).not.toMatch(RETIRED_FAMILY_PATTERN);
          expect(cls, `${kind} selection-only class "${cls}"`).not.toMatch(STATE_MADDER_PATTERN);
        }
        // Said out loud rather than reached through --primary's indirection —
        // that indirection is what let a hue read as live in these files for
        // three milestones.
        expect(diff.join(" ")).toContain("ink");
      });
    }
  });

  describe("KIND IS LEGIBLE, RENDERED — the gate 61-02's map gate structurally cannot be", () => {
    /**
     * Every class that any kind's geometry claims. The root's class string also
     * carries dimensions and the shared card base, so distinctness must be read
     * over THIS SLICE ALONE.
     *
     * WHY THAT MATTERS — this gate's own negative proof caught it: the first
     * version of this test compared whole root class STRINGS and passed happily
     * while `GenuiPanelNode` was deliberately mis-wired to the chat kind. The
     * four shells' dimension classes (`min-h-[320px]` vs `h-[220px]` ...) differ
     * on their own, so "all four are distinct" was true no matter what the
     * geometry said. It asserted the shells have different SIZES — a fact nobody
     * doubted — while reading as if it proved kind legibility. Exactly the
     * shape of defect this plan keeps finding: green, and about nothing.
     */
    const ALL_GEOMETRY_CLASSES = new Set(
      ALL_KINDS.flatMap((k) => Array.from(classSet(CANVAS_NODE_KIND_GEOMETRY[k]))),
    );

    function geometrySlice(root: HTMLElement): string {
      return Array.from(classSet(root.className))
        .filter((c) => ALL_GEOMETRY_CLASSES.has(c))
        .sort()
        .join(" ");
    }

    it("the real shells render mutually DISTINCT kind geometry", async () => {
      // 61-02 asserts the MAP's five values differ. This asserts the COMPONENTS
      // actually use them: wire one shell to the wrong key and 61-02 stays green
      // while two kinds become indistinguishable on the board.
      //
      // SEQUENTIALLY, never Promise.all: overlapping `act()` scopes interleave
      // and later mounts in this file then render nothing — a green-looking
      // "rendered nothing" is the vacuity trap, and it bit this very test once.
      const slices: string[] = [];
      for (const kind of REAL_KINDS) {
        slices.push(geometrySlice(await renderShell(kind)));
      }
      expect(
        new Set(slices).size,
        `two kinds render the SAME geometry:\n${REAL_KINDS.map((k, i) => `  ${k}: ${slices[i]}`).join("\n")}`,
      ).toBe(REAL_KINDS.length);
    });

    for (const kind of ALL_KINDS) {
      it(`${kind}: renders its OWN geometry and no other kind's distinguishing class`, async () => {
        const rendered = classSet((await renderShell(kind)).className);
        const own = classSet(CANVAS_NODE_KIND_GEOMETRY[kind]);

        for (const cls of own) {
          expect(
            rendered.has(cls),
            `${kind} does not render its own geometry class "${cls}"`,
          ).toBe(true);
        }

        for (const other of ALL_KINDS) {
          if (other === kind) continue;
          const otherOnly = Array.from(classSet(CANVAS_NODE_KIND_GEOMETRY[other])).filter(
            (c) => !own.has(c),
          );
          for (const cls of otherOnly) {
            expect(
              rendered.has(cls),
              `${kind} renders "${cls}", which belongs to the ${other} kind — a mis-wire`,
            ).toBe(false);
          }
        }
      });
    }

    it("kind is carried by RULE/geometry, never by a hue", async () => {
      for (const kind of REAL_KINDS) {
        const root = await renderShell(kind);
        expect(root.className, `${kind} root`).not.toMatch(TIER_TOKEN_PATTERN);
        expect(root.className, `${kind} root`).not.toMatch(RETIRED_FAMILY_PATTERN);
      }
    });
  });

  describe("LAW 2, BOTH WAYS — font-serif <=> data-evidence, over the whole rendered tree", () => {
    function serifAndEvidence(root: HTMLElement): {
      serif: Element[];
      evidence: Element[];
    } {
      const all = [root, ...Array.from(root.querySelectorAll("*"))];
      return {
        serif: all.filter((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes("font-serif")),
        evidence: all.filter((el) => el.hasAttribute("data-evidence")),
      };
    }

    for (const kind of ALL_KINDS) {
      it(`${kind}: every font-serif element carries data-evidence, and vice versa`, async () => {
        const root = await renderShell(kind);
        const { serif, evidence } = serifAndEvidence(root);
        for (const el of serif) {
          expect(
            el.hasAttribute("data-evidence"),
            `${kind}: <${el.tagName.toLowerCase()}> is font-serif without data-evidence — "${el.textContent?.slice(0, 40)}"`,
          ).toBe(true);
        }
        for (const el of evidence) {
          expect(
            (el.getAttribute("class") ?? "").split(/\s+/).includes("font-serif"),
            `${kind}: <${el.tagName.toLowerCase()}> is data-evidence without font-serif — "${el.textContent?.slice(0, 40)}"`,
          ).toBe(true);
        }
      });
    }

    it("EmailThreadNode: the subject and the snippet are the MAIL's own words -> serif", async () => {
      const root = await renderShell("email-thread");
      const { serif } = serifAndEvidence(root);
      const text = serif.map((el) => el.textContent ?? "");
      expect(text.some((t) => t.includes("Q3 renewal quote"))).toBe(true);
      expect(text.some((t) => t.includes("Total: $1,180.00"))).toBe(true);
    });

    it("EmailThreadNode: the participants line is polytoken's summary OF the mail -> sans", async () => {
      const root = await renderShell("email-thread");
      const parts = Array.from(root.querySelectorAll("span")).find((el) =>
        (el.textContent ?? "").includes("2 messages"),
      );
      expect(parts, "the participants line did not render").toBeDefined();
      expect(parts!.className).not.toContain("font-serif");
      expect(parts!.hasAttribute("data-evidence")).toBe(false);
      expect(parts!.closest("[data-evidence]")).toBeNull();
    });

    it("SourceNode: the title and the excerpt are the SOURCE's own words -> serif", async () => {
      const root = await renderShell("source");
      const { serif } = serifAndEvidence(root);
      const text = serif.map((el) => el.textContent ?? "");
      expect(text.some((t) => t.includes("Q3 pricing benchmarks"))).toBe(true);
      expect(text.some((t) => t.includes("4.1%"))).toBe(true);
    });

    it("SourceNode: the domain line is polytoken's summary OF the source -> sans", async () => {
      const root = await renderShell("source");
      const domain = Array.from(root.querySelectorAll("span")).find(
        (el) => (el.textContent ?? "") === "example.com",
      );
      expect(domain, "the domain line did not render (or kept its www.)").toBeDefined();
      expect(domain!.className).not.toContain("font-serif");
      expect(domain!.hasAttribute("data-evidence")).toBe(false);
      expect(domain!.closest("[data-evidence]")).toBeNull();
    });

    it("SourceNode: an auto-collected source wears the SUGGESTED provenance mark — dashed, never solid (RCNV-02)", async () => {
      // taste-references §3 (Phase 63): sources arrive auto-collected with the
      // dashed suggested mark — "they're suggestions until curated". The pmark
      // is THE signature element; a zero-ceremony capture claiming the solid
      // confirmed mark would be the one unforgivable tier lie on this surface.
      const root = await renderShell("source");
      const mark = root.querySelector(".pmark");
      expect(mark, "the source card renders no provenance mark").not.toBeNull();
      const markClass = mark!.getAttribute("class") ?? "";
      expect(markClass).toContain("pmark-suggested");
      expect(markClass).not.toContain("pmark-confirmed");
      expect(mark!.getAttribute("data-tier")).toBe("suggested");
      // pmark implies serif by INHERITANCE (brand-guide §3) — the container
      // must carry font-sans so chrome inside it never inherits the serif,
      // with the serif+data-evidence PAIR stated on the value span alone.
      expect(markClass).toContain("font-sans");
    });

    it("ChatNode: the title is chrome -> sans (61-06's explicit call, the pair to the thread's)", async () => {
      // A conversation title is user-authored or polytoken-generated. It is not
      // the user's mail, so it does not earn the serif. Read this with
      // email-thread-node.tsx's header — they are one decision.
      const root = await renderShell("chat");
      const { serif, evidence } = serifAndEvidence(root);
      expect(serif).toHaveLength(0);
      expect(evidence).toHaveLength(0);
    });
  });
});

describe("the wire (DataEdge)", () => {
  it("is NEUTRAL — a data wire is plumbing, not provenance, so it claims no tier", async () => {
    const container = await renderEdge();
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("class") ?? "").not.toMatch(TIER_TOKEN_PATTERN);
    expect(path!.getAttribute("style") ?? "").not.toMatch(TIER_TOKEN_PATTERN);
    // The tier's facts reach the path as VALUES: the stock .react-flow__edge-path
    // rule is UNLAYERED, so a layered utility class can never win here (61-05).
    expect(path!.style.stroke).toBe(CANVAS_EDGE_TIER_STYLE.neutral.stroke);
    expect(path!.style.strokeWidth).toBe(String(CANVAS_EDGE_TIER_STYLE.neutral.strokeWidth));
  });

  it("renders its label UNCONDITIONALLY — never hover-gated (23-UI-SPEC)", async () => {
    // "Makes wiring legible without opening the picker." A hover-revealed label
    // is invisible to touch and to a screenshot, which is most of how this
    // surface is reviewed.
    const container = await renderEdge();
    const label = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Edit connection"),
    );
    expect(label, "the edge label did not render").toBeDefined();
    expect(label!.textContent).toContain("thread");
    expect(label!.textContent).toContain("context");
    // getAttribute, never `.className`: the real EdgeLabelRenderer portals this
    // button into an HTML div, but the pass-through mock leaves it inside the
    // <svg>, where `.className` is an SVGAnimatedString object rather than a
    // string and `.toMatch` throws instead of asserting.
    const labelClass = label!.getAttribute("class") ?? "";
    expect(labelClass).not.toMatch(/\bhidden\b|\bopacity-0\b|group-hover:/);
    expect(labelClass).not.toMatch(/\bshadow-/);
  });

  it("keeps its click target — interactionWidth is what makes a 1.5px wire clickable", async () => {
    const container = await renderEdge();
    const interaction = container.querySelector("path.react-flow__edge-interaction");
    expect(interaction).not.toBeNull();
    expect(interaction!.getAttribute("stroke-width")).toBe("20");
  });
});

describe("the two edge projections agree — one fact, two spellings", () => {
  // CANVAS_EDGE_TIER (classes, for a CSS-box consumer) and
  // CANVAS_EDGE_TIER_STYLE (values, for a React Flow edge, which cannot use a
  // class — see canvas-vocabulary.ts's header). They restate one fact, so they
  // are asserted to agree rather than trusted to.
  const TIERS = ["neutral", "confirmed", "suggested"] as const;

  for (const tier of TIERS) {
    it(`${tier}: both spellings name the same token, width and dashedness`, async () => {
      const classes = CANVAS_EDGE_TIER[tier];
      const style = CANVAS_EDGE_TIER_STYLE[tier];

      // The token: `[stroke:var(--edge)]` / `stroke-conf-line` vs `var(--edge)`.
      const token = style.stroke.replace(/^var\(--/, "").replace(/\)$/, "");
      expect(
        classes.path.includes(token),
        `${tier}: class path "${classes.path}" does not name "${token}"`,
      ).toBe(true);
      expect(
        classes.joint.includes(token),
        `${tier}: class joint "${classes.joint}" does not name "${token}"`,
      ).toBe(true);

      // The width.
      expect(classes.path).toContain(`stroke-width:${style.strokeWidth}`);

      // Dashedness — tier owns solid-vs-dashed on every surface.
      expect(classes.path.includes("dasharray")).toBe(style.strokeDasharray !== undefined);
    });
  }

  it("neutral makes no tier claim in EITHER spelling (law 1: colour is earned)", () => {
    expect(CANVAS_EDGE_TIER.neutral.path).not.toMatch(TIER_TOKEN_PATTERN);
    expect(CANVAS_EDGE_TIER_STYLE.neutral.stroke).not.toMatch(TIER_TOKEN_PATTERN);
    expect(CANVAS_EDGE_TIER_STYLE.neutral.strokeDasharray).toBeUndefined();
  });
});
