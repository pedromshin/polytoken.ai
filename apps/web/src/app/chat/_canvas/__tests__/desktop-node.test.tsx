/**
 * desktop-node.test.tsx — the Cloud Desktop epoch's `desktop` canvas node
 * (VISION E5 / RFC §4): the standalone schema (panel-node-schemas.ts), the pure
 * label helper, the capability id strings the control-plane allowlist keys on,
 * and the component's rendered contract — the RENDER-ONLY SHELL (no networking,
 * no iframe mounted yet).
 *
 * Mirrors panel-nodes.test.tsx exactly: createRoot-in-jsdom + `act`, no trpc
 * mock (the shell fetches nothing by design), `@xyflow/react`'s `useReactFlow`
 * mocked via a PARTIAL factory. What this file pins: the DESKTOP_PANEL_CAPABILITY
 * _IDS literals, resolveDesktopLabel's order, the schema's ref-only guarantee
 * (NEVER a gateway url or a stream token in node.data), and law 2's SANS-only
 * chrome (a streamed machine is a VIEW, never the user's own authored words).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import { DesktopNodeDataSchema } from "../panel-node-schemas";
import { CANVAS_NODE_KIND_GEOMETRY } from "../canvas-vocabulary";

const mockDeleteElements = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ deleteElements: mockDeleteElements }),
  };
});

import {
  DESKTOP_PANEL_CAPABILITY_IDS,
  DesktopNode,
  resolveDesktopLabel,
  type DesktopNodeType,
} from "../desktop-node";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Schema — REF-ONLY, and harder: NEVER a gateway url or a stream token
// ---------------------------------------------------------------------------

describe("DesktopNodeDataSchema", () => {
  it("accepts a full valid payload and an empty one (a node before its session)", () => {
    expect(
      DesktopNodeDataSchema.safeParse({
        sessionId: "sess_abc123",
        status: "running",
        label: "Dev box",
        region: "eu-central",
        shape: "CPX41",
      }).success,
    ).toBe(true);
    expect(DesktopNodeDataSchema.safeParse({}).success).toBe(true);
  });

  it("accepts exactly the four lifecycle statuses and rejects any other", () => {
    for (const status of ["provisioning", "running", "hibernated", "destroyed"]) {
      expect(DesktopNodeDataSchema.safeParse({ status }).success).toBe(true);
    }
    expect(DesktopNodeDataSchema.safeParse({ status: "paused" }).success).toBe(false);
  });

  it("REF-ONLY: refuses a gateway url or a stream token in node.data (.strict())", () => {
    // The keys this schema exists to refuse — minted server-side per session at
    // desktop.attach time (RFC §4.3), NEVER persisted into a layout row.
    expect(
      DesktopNodeDataSchema.safeParse({ sessionId: "s", url: "https://gw.example" })
        .success,
    ).toBe(false);
    expect(
      DesktopNodeDataSchema.safeParse({ sessionId: "s", gatewayUrl: "https://gw" })
        .success,
    ).toBe(false);
    expect(
      DesktopNodeDataSchema.safeParse({ sessionId: "s", token: "eyJ..." }).success,
    ).toBe(false);
    expect(
      DesktopNodeDataSchema.safeParse({ sessionId: "s", streamToken: "eyJ..." }).success,
    ).toBe(false);
  });

  it("rejects an empty sessionId and an unrecognized extra key (.strict())", () => {
    expect(DesktopNodeDataSchema.safeParse({ sessionId: "" }).success).toBe(false);
    expect(DesktopNodeDataSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Capability id strings — the ONLY control-plane coupling this panel has (INV-2)
// ---------------------------------------------------------------------------

describe("capability id strings", () => {
  it("names the four desktop.* lifecycle ids exactly (RFC §5.1)", () => {
    expect(DESKTOP_PANEL_CAPABILITY_IDS).toEqual({
      spawn: "desktop.spawn",
      attach: "desktop.attach",
      hibernate: "desktop.hibernate",
      destroy: "desktop.destroy",
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe("resolveDesktopLabel", () => {
  it("explicit label wins; otherwise the fallback literal", () => {
    expect(resolveDesktopLabel("My machine")).toBe("My machine");
    expect(resolveDesktopLabel(undefined)).toBe("Cloud desktop");
    expect(resolveDesktopLabel("")).toBe("Cloud desktop");
  });
});

// ---------------------------------------------------------------------------
// Registered geometry — rule-2 DOTTED + right seam, distinct from every sibling
// ---------------------------------------------------------------------------

describe("registered desktop kind geometry", () => {
  it("pins the registered literal", () => {
    expect(CANVAS_NODE_KIND_GEOMETRY.desktop).toBe(
      "border-l-2 border-l-ink border-r-2 border-r-ink border-dotted",
    );
  });

  it("claims no DASHED (tier owns it) and no hue (kind is shape, law 3)", () => {
    const cls = CANVAS_NODE_KIND_GEOMETRY.desktop;
    expect(cls).not.toContain("dashed");
    expect(cls).not.toMatch(/border-[lr]-(?!ink)[a-z]+(?:-\d+)?(?:\s|$)/);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

function baseNodeProps(id: string, type: string): Record<string, unknown> {
  return {
    id,
    type,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

beforeEach(() => {
  mockDeleteElements.mockReset();
});

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
});

async function mountDesktop(
  data: Record<string, unknown> = { sessionId: "sess_1", status: "running" },
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <DesktopNode
        {...({
          ...baseNodeProps("desktop:1", "desktop"),
          data,
        } as unknown as NodeProps<DesktopNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

describe("DesktopNode — rendered contract", () => {
  it("wears the registered desktop geometry with zero shadow", async () => {
    const container = await mountDesktop();
    const root = container.firstElementChild as HTMLElement;
    for (const cls of CANVAS_NODE_KIND_GEOMETRY.desktop.split(/\s+/)) {
      expect(root.className, `missing geometry class "${cls}"`).toContain(cls);
    }
    expect(root.className).not.toMatch(/\bshadow-elevation-/);
  });

  it("THE JAIL: mounts NO iframe and NO remote src, ever", async () => {
    const container = await mountDesktop();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[href^='http']")).toBeNull();
  });

  it("header label is polytoken's word — SANS, never serif/data-evidence (law 2)", async () => {
    const container = await mountDesktop({ label: "Dev box" });
    const header = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Dev box" && el.childElementCount === 0,
    );
    expect(header, "the resolved desktop label did not render").toBeDefined();
    expect(header!.className).not.toContain("font-serif");
    expect(header!.hasAttribute("data-evidence")).toBe(false);
  });

  it("NOWHERE on the card is font-serif or data-evidence used (a VIEW, not the user's words)", async () => {
    const container = await mountDesktop();
    expect(container.querySelector(".font-serif")).toBeNull();
    expect(container.querySelector("[data-evidence]")).toBeNull();
  });

  it("the placeholder is status-aware — running vs no-session teach different states", async () => {
    const running = await mountDesktop({ sessionId: "s", status: "running" });
    expect(running.textContent).toContain("running");
    const none = await mountDesktop({});
    expect(none.textContent).toContain("No desktop session yet");
    expect(none.textContent).toContain("no session");
  });

  it("the footer names the capability it keys on (via desktop.attach)", async () => {
    const container = await mountDesktop();
    expect(container.textContent).toContain("via desktop.attach");
  });

  it("renders an HONEST disabled fullscreen stub (CD-3), no overlay wiring yet", async () => {
    const container = await mountDesktop();
    const expand = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Fullscreen",
    );
    expect(expand, "the fullscreen stub did not render").toBeDefined();
    expect(expand!.disabled).toBe(true);
    expect(expand!.getAttribute("title")).toContain("CD-3");
  });

  it("Remove drops only the placement — never a side-effect desktop.destroy (T-61-19)", async () => {
    const container = await mountDesktop();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove desktop panel",
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.click();
    });
    expect(mockDeleteElements).toHaveBeenCalledWith({ nodes: [{ id: "desktop:1" }] });
  });
});
