/**
 * browser-node-screenshot.test.tsx — regression coverage for Task 2, bug 1:
 * the browser panel's live screenshot path threw / silently hung on a
 * malformed `browser.screenshot` reply.
 *
 * THE BUG (pre-fix): handleSubmit read `frame.output.base64` directly. The
 * daemon-tool wire type says `output: Record<string, unknown>`, but that is
 * nominal only — `use-daemon-tool`'s decoder casts `payload.output` straight
 * through, so a `tool.result` missing `output` resolves to `{ ok: true,
 * output: undefined }`. Reading `.base64` off that threw
 * `TypeError: Cannot read properties of undefined`; because the read lived in a
 * fire-and-forget `void (async () => …)()`, the throw became an unhandled
 * rejection and the panel stayed on "Loading" forever. A sibling shape —
 * `ok: true` with a non-string `base64` — matched NEITHER branch and hung the
 * same way.
 *
 * THE FIX: `readScreenshot` is total (never throws; always → ok | error) and
 * the panel renders its error instead of wedging. These tests pin both the
 * pure function and the rendered live path (daemon mocked to "ready").
 *
 * The component path mounts the REAL BrowserNode with `use-daemon-tool` mocked
 * so no WebSocket is opened; `@xyflow/react`'s `useReactFlow` is partial-mocked
 * (mirrors panel-nodes.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import type { ToolCallResult, UseDaemonTool } from "../_lib/use-daemon-tool";

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return { ...actual, useReactFlow: () => ({ deleteElements: vi.fn() }) };
});

// The daemon bridge is mocked per-test so the component runs its LIVE path
// (status "ready") without opening a socket. `daemonCallImpl` is swapped by
// each test to return the frame shape under test.
let daemonCallImpl: (tool: string, args: unknown) => Promise<ToolCallResult> = async () => ({
  ok: false,
  error: "unset",
});
let daemonStatus: UseDaemonTool["status"] = "ready";

vi.mock("../_lib/use-daemon-tool", () => ({
  useDaemonTool: (): UseDaemonTool => ({
    status: daemonStatus,
    pendingPermissions: [],
    call: (tool: string, args: unknown) => daemonCallImpl(tool, args),
    resolvePermission: () => {},
  }),
}));

import { BrowserNode, readScreenshot, type BrowserNodeType } from "../browser-node";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Pure function: readScreenshot ───────────────────────────────────────────

describe("readScreenshot — malformed frames never throw (Task 2, bug 1)", () => {
  it("THE ORIGINAL CRASH: ok:true with output undefined → error, does not throw", () => {
    // This is the exact shape a `tool.result` missing `output` decodes to. The
    // old call site did `frame.output.base64` and threw a TypeError here.
    const frame = { ok: true, output: undefined } as unknown as ToolCallResult;
    expect(() => readScreenshot(frame)).not.toThrow();
    const result = readScreenshot(frame);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("no screenshot") });
  });

  it("ok:true with output null → error, does not throw", () => {
    const frame = { ok: true, output: null } as unknown as ToolCallResult;
    expect(() => readScreenshot(frame)).not.toThrow();
    expect(readScreenshot(frame).ok).toBe(false);
  });

  it("THE SILENT HANG: ok:true with a non-string base64 → error (matched no branch before)", () => {
    const frame = { ok: true, output: { base64: 42 } } as unknown as ToolCallResult;
    const result = readScreenshot(frame);
    expect(result.ok).toBe(false);
  });

  it("ok:true with an empty base64 → error (an empty PNG is not renderable)", () => {
    const frame: ToolCallResult = { ok: true, output: { base64: "" } };
    expect(readScreenshot(frame).ok).toBe(false);
  });

  it("a truncated frame is refused — a partial PNG paints a broken image", () => {
    const frame: ToolCallResult = {
      ok: true,
      output: { base64: "aGk=", bytes: 9_999_999, truncated: true },
    };
    const result = readScreenshot(frame);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("truncated") });
  });

  it("passes a daemon error straight through", () => {
    const frame: ToolCallResult = { ok: false, error: "no browser session is open" };
    expect(readScreenshot(frame)).toEqual({ ok: false, error: "no browser session is open" });
  });

  it("a well-formed frame yields the base64 for the <img> data URI", () => {
    const frame: ToolCallResult = {
      ok: true,
      output: { base64: "iVBORw0KGgo=", bytes: 8, truncated: false },
    };
    expect(readScreenshot(frame)).toEqual({ ok: true, base64: "iVBORw0KGgo=" });
  });
});

// ── Rendered live path ───────────────────────────────────────────────────────

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
  vi.restoreAllMocks();
  daemonStatus = "ready";
});

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

async function mountBrowser(): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <BrowserNode
        {...({
          ...baseNodeProps("browser:1", "browser"),
          data: {},
        } as unknown as NodeProps<BrowserNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

async function submitUrl(container: HTMLElement, url: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='Address']")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = container.querySelector("form")!;
  await act(async () => {
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // let the fire-and-forget navigate+screenshot promises settle
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BrowserNode live path — a malformed screenshot never wedges the panel", () => {
  it("REGRESSION: navigate ok + screenshot missing output → error shown, not stuck on Loading", async () => {
    daemonStatus = "ready";
    daemonCallImpl = async (tool) => {
      if (tool === "browser.navigate") {
        return { ok: true, output: { kind: "browser.navigate", url: "https://x.test/", title: "X" } };
      }
      // The crash shape: a screenshot reply with no output field.
      return { ok: true, output: undefined } as unknown as ToolCallResult;
    };

    const container = await mountBrowser();
    await submitUrl(container, "x.test");

    // Pre-fix this threw (unhandled) and the copy below stayed "Loading …".
    expect(container.textContent).toContain("The daemon refused");
    expect(container.textContent).toContain("no screenshot");
    expect(container.textContent).not.toContain("Loading");
    // No <img> was mounted — there was nothing renderable.
    expect(container.querySelector("img")).toBeNull();
  });

  it("navigate ok + a well-formed screenshot renders the data: PNG and clears the pending state", async () => {
    daemonStatus = "ready";
    daemonCallImpl = async (tool) => {
      if (tool === "browser.navigate") {
        return { ok: true, output: { kind: "browser.navigate", url: "https://x.test/", title: "X" } };
      }
      return {
        ok: true,
        output: { kind: "browser.screenshot", base64: "iVBORw0KGgo=", bytes: 8, truncated: false },
      };
    };

    const container = await mountBrowser();
    await submitUrl(container, "x.test");

    const img = container.querySelector<HTMLImageElement>("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(container.textContent).not.toContain("Loading");
  });

  it("navigate refusal surfaces the daemon error and never asks for a screenshot", async () => {
    daemonStatus = "ready";
    const calls: string[] = [];
    daemonCallImpl = async (tool) => {
      calls.push(tool);
      return { ok: false, error: "no browser session is open" };
    };

    const container = await mountBrowser();
    await submitUrl(container, "x.test");

    expect(container.textContent).toContain("no browser session is open");
    expect(calls).toEqual(["browser.navigate"]); // screenshot never attempted
  });
});
