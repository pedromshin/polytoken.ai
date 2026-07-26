/**
 * build-tool-dialog.test.tsx — the summon-loop intent prompt (Phase 76 / 76-04b).
 * Proves: it opens on a nonce bump (not on mount), shows the wired-source labels,
 * hands the TRIMMED typed intent to onBuild, falls back to "" on an empty field
 * (the caller turns that into the default intent), and respects `pending`.
 *
 * Radix Dialog portals its content to document.body (mirrors add-node-menu.test).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuildToolDialog } from "../build-tool-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

interface RenderOpts {
  readonly nonce: number;
  readonly sourceLabels?: readonly string[];
  readonly pending?: boolean;
  readonly onBuild: (intent: string) => void;
}

async function render(opts: RenderOpts): Promise<void> {
  await act(async () => {
    root.render(
      <BuildToolDialog
        requestOpenNonce={opts.nonce}
        sourceLabels={opts.sourceLabels ?? ["Spend", "Rent"]}
        pending={opts.pending ?? false}
        onBuild={opts.onBuild}
      />,
    );
  });
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}
function textarea(): HTMLTextAreaElement {
  const el = document.body.querySelector<HTMLTextAreaElement>("#build-tool-intent");
  if (!el) throw new Error("intent textarea not found");
  return el;
}
function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!el) throw new Error(`button "${text}" not found`);
  return el;
}
async function type(value: string): Promise<void> {
  const ta = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.querySelectorAll('[role="dialog"], [data-radix-portal]').forEach((n) => n.remove());
});

describe("BuildToolDialog", () => {
  it("does not open on mount (initial nonce)", async () => {
    await render({ nonce: 0, onBuild: vi.fn() });
    expect(dialog()).toBeNull();
  });

  it("opens on a nonce bump and shows the wired-source labels", async () => {
    const onBuild = vi.fn();
    await render({ nonce: 0, onBuild });
    await render({ nonce: 1, sourceLabels: ["Spend", "Rent"], onBuild });
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent ?? "").toContain("Spend, Rent");
  });

  it("hands the trimmed typed intent to onBuild and closes", async () => {
    const onBuild = vi.fn();
    await render({ nonce: 0, onBuild });
    await render({ nonce: 1, onBuild });
    await type("  Reconcile rent vs spend  ");
    await click(buttonByText("Build"));
    expect(onBuild).toHaveBeenCalledWith("Reconcile rent vs spend");
    expect(dialog()).toBeNull();
  });

  it("falls back to empty string when the field is blank", async () => {
    const onBuild = vi.fn();
    await render({ nonce: 0, onBuild });
    await render({ nonce: 1, onBuild });
    await click(buttonByText("Build"));
    expect(onBuild).toHaveBeenCalledWith("");
  });

  it("does not build while pending (guards a double summon)", async () => {
    const onBuild = vi.fn();
    await render({ nonce: 0, onBuild });
    await render({ nonce: 1, pending: true, onBuild });
    await click(buttonByText("Building…"));
    expect(onBuild).not.toHaveBeenCalled();
  });
});
