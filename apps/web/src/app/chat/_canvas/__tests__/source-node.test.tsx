/**
 * source-node.test.tsx — SourceNode (RCNV-02 / RSRCH-03): the versioned-
 * registry `source` node type (node.data schema/registry/dimensions/kind)
 * plus the component's rendered contract — the provenance pmark on the title,
 * the law-2 serif/evidence pairing, the suggest-only tier default, the
 * http(s)-only href guard, and remove wiring.
 *
 * "registry" describe block mirrors email-thread-node.test.tsx's conventions
 * (that file's own header sanctions keeping per-type registry facts beside
 * the component rather than in node-type-registry.test.ts).
 *
 * Component tests mount the REAL component (createRoot-in-jsdom + `act`,
 * mirrors email-thread-node.test.tsx / knowledge-preview-node.test.tsx).
 * SourceNode itself fetches NOTHING — node.data carries the immutable ledger
 * capture (see SourceNodeDataSchema's header) — but `~/trpc/react` is still
 * mocked because the `nodeTypes` wiring assertion imports `../node-types`,
 * whose sibling node components import the real trpc client at module scope.
 * `@xyflow/react`'s `useReactFlow` is mocked via a PARTIAL factory; `sonner`
 * is mocked for the same transitive-import reason.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import {
  computeNodeRegistryHash,
  NODE_REGISTRY_VERSION,
} from "../node-registry-version";
import { SourceNodeDataSchema } from "../node-data-schemas";
import { NODE_TYPE_REGISTRY } from "../node-type-registry";
import type { NodeTypeRegistryEntry } from "../node-type-registry";
import { CANVAS_NODE_DIMENSIONS } from "../canvas-layout";
import { canvasNodeKindOf, CANVAS_NODE_KIND_GEOMETRY } from "../canvas-vocabulary";
import { sourceNodeId } from "../use-canvas-persistence";

const VALID_LEDGER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_URL = "https://www.example.com/research/q3-pricing";
const VALID_TITLE = "Q3 pricing benchmarks for renewals";
const VALID_EXCERPT = "Median renewal uplift across the sampled contracts was 4.1%.";

function validData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceLedgerId: VALID_LEDGER_ID,
    url: VALID_URL,
    title: VALID_TITLE,
    excerpt: VALID_EXCERPT,
    tier: "suggested",
    ...overrides,
  };
}

describe("registry", () => {
  describe("SourceNodeDataSchema", () => {
    it("accepts a full valid payload", () => {
      expect(SourceNodeDataSchema.safeParse(validData()).success).toBe(true);
    });

    it("accepts a payload with no excerpt and no tier (both optional)", () => {
      expect(
        SourceNodeDataSchema.safeParse({
          sourceLedgerId: VALID_LEDGER_ID,
          url: VALID_URL,
          title: VALID_TITLE,
        }).success,
      ).toBe(true);
    });

    it("accepts plain http as well as https", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ url: "http://example.org/a" })).success,
      ).toBe(true);
    });

    it("rejects a javascript: url — the XSS door this schema exists to close", () => {
      expect(
        // eslint-disable-next-line no-script-url
        SourceNodeDataSchema.safeParse(validData({ url: "javascript:alert(1)" })).success,
      ).toBe(false);
    });

    it("rejects a data: url", () => {
      expect(
        SourceNodeDataSchema.safeParse(
          validData({ url: "data:text/html,<script>alert(1)</script>" }),
        ).success,
      ).toBe(false);
    });

    it("rejects a relative url", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ url: "/not/absolute" })).success,
      ).toBe(false);
    });

    it("rejects a non-uuid sourceLedgerId", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ sourceLedgerId: "not-a-uuid" })).success,
      ).toBe(false);
    });

    it("rejects an empty title and a title over 300 characters", () => {
      expect(SourceNodeDataSchema.safeParse(validData({ title: "" })).success).toBe(false);
      expect(
        SourceNodeDataSchema.safeParse(validData({ title: "a".repeat(301) })).success,
      ).toBe(false);
    });

    it("rejects an excerpt over 500 characters (the seam must truncate)", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ excerpt: "a".repeat(501) })).success,
      ).toBe(false);
    });

    it("rejects an unknown tier value — the enum admits no third state", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ tier: "captured" })).success,
      ).toBe(false);
    });

    it("rejects an unrecognized extra top-level key (.strict())", () => {
      expect(
        SourceNodeDataSchema.safeParse(validData({ extra: true })).success,
      ).toBe(false);
    });
  });

  describe("NODE_TYPE_REGISTRY['source']", () => {
    it("exists with dataSchema === SourceNodeDataSchema", () => {
      expect(NODE_TYPE_REGISTRY.source).toBeDefined();
      expect(NODE_TYPE_REGISTRY.source?.dataSchema).toBe(SourceNodeDataSchema);
      expect(NODE_TYPE_REGISTRY.source?.id).toBe("source");
    });
  });

  describe("computeNodeRegistryHash", () => {
    it("flips when the source entry is added vs a registry without it", () => {
      const withoutSource: Record<string, NodeTypeRegistryEntry> = {
        ...NODE_TYPE_REGISTRY,
      };
      delete withoutSource.source;

      expect(computeNodeRegistryHash(withoutSource)).not.toBe(
        computeNodeRegistryHash(NODE_TYPE_REGISTRY),
      );
    });

    it("NODE_REGISTRY_VERSION reflects the CURRENT registry (incl. source)", () => {
      expect(NODE_REGISTRY_VERSION).toBe(computeNodeRegistryHash(NODE_TYPE_REGISTRY));
    });
  });

  describe("CANVAS_NODE_DIMENSIONS['source']", () => {
    it("is fixed 300x180", () => {
      expect(CANVAS_NODE_DIMENSIONS.source).toEqual({ width: 300, height: 180 });
    });
  });

  describe("vocabulary + id seam", () => {
    it("canvasNodeKindOf('source') resolves to its own kind, never unknown", () => {
      expect(canvasNodeKindOf("source")).toBe("source");
    });

    it("sourceNodeId derives the canonical `source:<ledgerId>` node id (the wiring seam's key)", () => {
      expect(sourceNodeId(VALID_LEDGER_ID)).toBe(`source:${VALID_LEDGER_ID}`);
    });
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

const mockDeleteElements = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ deleteElements: mockDeleteElements }),
  };
});

// Needed ONLY for the `../node-types` wiring import below — SourceNode itself
// never touches trpc (see the file header).
vi.mock("~/trpc/react", () => ({ api: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  resolveSourceTier,
  safeSourceHref,
  sourceDomain,
  SourceNode,
  type SourceNodeType,
} from "../source-node";
import { nodeTypes, resolveNodeComponent } from "../node-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeNodeProps(
  overrides: Partial<NodeProps<SourceNodeType>> = {},
): NodeProps<SourceNodeType> {
  return {
    id: sourceNodeId(VALID_LEDGER_ID),
    data: {
      sourceLedgerId: VALID_LEDGER_ID,
      url: VALID_URL,
      title: VALID_TITLE,
      excerpt: VALID_EXCERPT,
      tier: "suggested",
    },
    type: "source",
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
  } as NodeProps<SourceNodeType>;
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

async function mountNode(
  overrides: Partial<NodeProps<SourceNodeType>> = {},
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <SourceNode {...makeNodeProps(overrides)} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  mockDeleteElements.mockReset();
});

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
});

describe("url helpers", () => {
  it("safeSourceHref accepts absolute http(s) and nothing else", () => {
    expect(safeSourceHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeSourceHref("http://example.com/a")).toBe("http://example.com/a");
    // eslint-disable-next-line no-script-url
    expect(safeSourceHref("javascript:alert(1)")).toBeNull();
    expect(safeSourceHref("data:text/html,x")).toBeNull();
    expect(safeSourceHref("file:///etc/passwd")).toBeNull();
    expect(safeSourceHref("/relative/path")).toBeNull();
    expect(safeSourceHref("")).toBeNull();
  });

  it("sourceDomain strips www. and is null for an unsafe url", () => {
    expect(sourceDomain("https://www.example.com/research")).toBe("example.com");
    expect(sourceDomain("https://docs.example.org/a?b=c")).toBe("docs.example.org");
    // eslint-disable-next-line no-script-url
    expect(sourceDomain("javascript:alert(1)")).toBeNull();
  });

  it("resolveSourceTier defaults absent tier to suggested, NEVER confirmed (suggest-only stance)", () => {
    expect(resolveSourceTier(undefined)).toBe("suggested");
    expect(resolveSourceTier("suggested")).toBe("suggested");
    expect(resolveSourceTier("confirmed")).toBe("confirmed");
  });
});

describe("SourceNode — rendered contract", () => {
  it("renders the shell on the source kind geometry with zero shadow", async () => {
    const container = await mountNode();
    const root = container.firstElementChild as HTMLElement;
    for (const cls of CANVAS_NODE_KIND_GEOMETRY.source.split(/\s+/)) {
      expect(root.className, `missing geometry class "${cls}"`).toContain(cls);
    }
    expect(root.className).not.toMatch(/\bshadow-elevation-/);
  });

  it("wears the SUGGESTED pmark on the title with the serif/data-evidence pair on the value span", async () => {
    const container = await mountNode();
    const mark = container.querySelector(".pmark");
    expect(mark).not.toBeNull();
    const markClass = mark!.getAttribute("class") ?? "";
    expect(markClass).toContain("pmark-suggested");
    expect(markClass).toContain("font-sans");
    expect(mark!.getAttribute("data-tier")).toBe("suggested");

    const value = mark!.querySelector("[data-evidence]");
    expect(value).not.toBeNull();
    expect(value!.getAttribute("class") ?? "").toContain("font-serif");
    expect(value!.textContent).toBe(VALID_TITLE);
  });

  it("flips the pmark solid-confirmed once the source has been promoted (tier: confirmed)", async () => {
    const container = await mountNode({
      data: {
        sourceLedgerId: VALID_LEDGER_ID,
        url: VALID_URL,
        title: VALID_TITLE,
        tier: "confirmed",
      },
    });
    const mark = container.querySelector(".pmark");
    expect(mark).not.toBeNull();
    const markClass = mark!.getAttribute("class") ?? "";
    expect(markClass).toContain("pmark-confirmed");
    expect(markClass).not.toContain("pmark-suggested");
    expect(mark!.getAttribute("data-tier")).toBe("confirmed");
  });

  it("an ABSENT tier renders suggested — an auto-capture never claims a confirmation", async () => {
    const container = await mountNode({
      data: { sourceLedgerId: VALID_LEDGER_ID, url: VALID_URL, title: VALID_TITLE },
    });
    expect(container.querySelector(".pmark")!.getAttribute("data-tier")).toBe("suggested");
  });

  it("renders the excerpt as the source's own sentence (serif + data-evidence) and the domain as sans chrome", async () => {
    const container = await mountNode();

    const excerpt = Array.from(container.querySelectorAll("p")).find((el) =>
      (el.textContent ?? "").includes("4.1%"),
    );
    expect(excerpt, "the excerpt did not render").toBeDefined();
    expect(excerpt!.className).toContain("font-serif");
    expect(excerpt!.hasAttribute("data-evidence")).toBe(true);

    const domain = Array.from(container.querySelectorAll("span")).find(
      (el) => (el.textContent ?? "") === "example.com",
    );
    expect(domain, "the www-stripped domain did not render").toBeDefined();
    expect(domain!.className).not.toContain("font-serif");
    expect(domain!.hasAttribute("data-evidence")).toBe(false);
  });

  it("shows the no-excerpt state in sans when no excerpt was captured", async () => {
    const container = await mountNode({
      data: { sourceLedgerId: VALID_LEDGER_ID, url: VALID_URL, title: VALID_TITLE },
    });
    const empty = Array.from(container.querySelectorAll("p")).find((el) =>
      (el.textContent ?? "").includes("No excerpt"),
    );
    expect(empty, "the no-excerpt state did not render").toBeDefined();
    expect(empty!.className).not.toContain("font-serif");
    expect(empty!.hasAttribute("data-evidence")).toBe(false);
  });

  it("Open source is a 1-click external link: real href, new tab, noopener", async () => {
    const container = await mountNode();
    const link = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("Open source"),
    );
    expect(link, "the Open-source action did not render").toBeDefined();
    expect(link!.getAttribute("href")).toBe(VALID_URL);
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel") ?? "").toContain("noopener");
    expect(link!.getAttribute("aria-disabled")).toBe("false");
  });

  it("a tampered non-http(s) url NEVER mounts as an href — the action degrades to disabled (T-61-04)", async () => {
    // node.data arrives from a user-writable layout row, and the restore path
    // validates only the generic snapshot schema — so the component itself is
    // the last gate between a hostile persisted url and the DOM.
    const container = await mountNode({
      data: {
        sourceLedgerId: VALID_LEDGER_ID,
        // eslint-disable-next-line no-script-url
        url: "javascript:alert(1)",
        title: VALID_TITLE,
      },
    });
    const link = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("Open source"),
    );
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("#");
    expect(link!.getAttribute("aria-disabled")).toBe("true");
    expect(link!.className).toContain("pointer-events-none");

    // ...and the domain line states the degrade honestly.
    const fallback = Array.from(container.querySelectorAll("span")).find(
      (el) => (el.textContent ?? "") === "Link unavailable",
    );
    expect(fallback, "the unsafe-url fallback did not render").toBeDefined();
  });

  it("falls back to 'Untitled source' for a blank title", async () => {
    const container = await mountNode({
      data: { sourceLedgerId: VALID_LEDGER_ID, url: VALID_URL, title: "   " },
    });
    expect(container.textContent).toContain("Untitled source");
  });

  it("Remove drops only the placement via deleteElements (ink control, T-61-19)", async () => {
    const container = await mountNode();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove source",
    );
    expect(remove, "no Remove control rendered").toBeDefined();
    await act(async () => {
      remove!.click();
    });
    expect(mockDeleteElements).toHaveBeenCalledWith({
      nodes: [{ id: sourceNodeId(VALID_LEDGER_ID) }],
    });
  });

  it("node-types.ts wiring: nodeTypes['source'] resolves to SourceNode", () => {
    expect(nodeTypes.source).toBe(SourceNode);
    expect(resolveNodeComponent("source")).toBe(SourceNode);
  });
});
