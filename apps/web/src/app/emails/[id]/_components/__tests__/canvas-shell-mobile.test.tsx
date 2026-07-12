/**
 * canvas-shell-mobile.test.tsx — 53-04-PLAN.md Task 1: proves CanvasShell's
 * MOBL-02 Sheet-collapse of LAYERS/INSPECTOR/SUMMARY below `md`
 * (53-UI-SPEC.md §5, Judgment Call #7) without regressing the desktop
 * always-visible side panels.
 *
 * Mounts the REAL `CanvasShell` with a minimal fake `CanvasState` (only
 * `mode`/`setMode` are actually read by CanvasShell/CanvasToolbar — every
 * other field is stubbed via an `as unknown as CanvasState` cast, mirroring
 * this suite's own "minimal fake state" acceptance criterion) and simple
 * string slot nodes for layers/inspector/summary/canvas — createRoot-in-jsdom
 * + `act`, mirrors `inbox-mobile-stack.test.tsx`'s (53-03) convention.
 *
 * The persistent LAYERS/INSPECTOR panels and the mobile Sheet triggers are
 * asserted via a source-string check (both trees mount unconditionally in
 * jsdom — no CSS media-query evaluation there — so a literal class-string
 * assertion on source is the reliable way to prove the `hidden md:flex` /
 * `md:hidden` gating exists, same convention `inbox-mobile-stack.test.tsx`
 * uses for its own `hidden md:block` / `md:hidden` wrapper assertion).
 * Opening a Sheet is asserted against the LIVE DOM: Radix `Dialog.Content`
 * (which `SheetContent` wraps) only mounts into `document.body` via Portal
 * once `open` is true, and sets `role="dialog"` — so querying
 * `document.body` for `[role="dialog"]` before/after a trigger click proves
 * the Sheet actually opens and carries the slot content, not just that the
 * (always-present, `hidden`-below-md) persistent copy exists somewhere in
 * the tree.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasShell } from "../canvas-shell";

import type { CanvasState } from "../use-canvas-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL_SOURCE = readFileSync(
  path.join(__dirname, "..", "canvas-shell.tsx"),
  "utf-8",
);
const TOOLBAR_SOURCE = readFileSync(
  path.join(__dirname, "..", "canvas-toolbar.tsx"),
  "utf-8",
);

/** Minimal fake — only `mode`/`setMode` are read by CanvasShell/CanvasToolbar. */
const FAKE_STATE = {
  mode: "select",
  setMode: () => undefined,
} as unknown as CanvasState;

const LAYERS_CONTENT = "LAYERS_SLOT_CONTENT";
const INSPECTOR_CONTENT = "INSPECTOR_SLOT_CONTENT";
const SUMMARY_CONTENT = "SUMMARY_SLOT_CONTENT";
const CANVAS_CONTENT = "CANVAS_SLOT_CONTENT";

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
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
  // Radix Dialog portals its content directly onto document.body — clean up
  // any leftover open-Sheet nodes between tests.
  document.body
    .querySelectorAll('[role="dialog"], [data-radix-portal]')
    .forEach((node) => node.remove());
});

function renderShell() {
  return mount(
    <CanvasShell
      state={FAKE_STATE}
      showRegions={false}
      onShowRegionsChange={() => undefined}
      showHistory={false}
      onShowHistoryChange={() => undefined}
      showUnrelated={false}
      onShowUnrelatedChange={() => undefined}
      onClose={() => undefined}
      layers={LAYERS_CONTENT}
      inspector={INSPECTOR_CONTENT}
      summary={SUMMARY_CONTENT}
      canvas={CANVAS_CONTENT}
    />,
  );
}

describe("CanvasShell mobile Sheet-collapse (MOBL-02, 53-UI-SPEC §5)", () => {
  it("(a) the persistent LAYERS and INSPECTOR panels carry hidden + md:flex — not persistent below md", () => {
    // Every w-64/w-72 persistent panel div is gated `hidden md:flex md:flex-col`.
    expect(SHELL_SOURCE).toContain(
      'className="hidden md:flex md:flex-col w-64 shrink-0 border-r overflow-hidden"',
    );
    expect(SHELL_SOURCE).toContain(
      'className="hidden md:flex md:flex-col w-72 shrink-0 border-l overflow-hidden"',
    );
    // No persistent panel div omits the hidden/md:flex gate.
    expect(SHELL_SOURCE).not.toMatch(
      /className="w-(64|72) shrink-0 border-[rl] overflow-hidden flex flex-col"/,
    );
  });

  it("(b) a Layers trigger and a PanelRight trigger are present, both aria-labelled and md:hidden", () => {
    expect(TOOLBAR_SOURCE).toContain('aria-label="Show layers"');
    expect(TOOLBAR_SOURCE).toContain('aria-label="Show inspector"');
    // Both new trigger buttons carry md:hidden on the SAME element as their
    // aria-label (desktop keeps no toolbar change) — tolerant of surrounding
    // whitespace/attribute-order, unlike an exact adjacent-substring match.
    expect(TOOLBAR_SOURCE).toMatch(
      /aria-label="Show layers"[\s\S]{0,80}className="md:hidden/,
    );
    expect(TOOLBAR_SOURCE).toMatch(
      /aria-label="Show inspector"[\s\S]{0,80}className="md:hidden/,
    );
  });

  it("renders both mobile Sheet triggers in the DOM with the expected aria-labels", async () => {
    const container = await renderShell();

    const layersTrigger = container.querySelector('[aria-label="Show layers"]');
    const inspectorTrigger = container.querySelector('[aria-label="Show inspector"]');
    expect(layersTrigger).not.toBeNull();
    expect(inspectorTrigger).not.toBeNull();
  });

  it("(c) clicking the Show layers trigger opens a Sheet containing the layers slot content", async () => {
    const container = await renderShell();

    // No Sheet is mounted into document.body before any trigger is tapped.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    const layersTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show layers"]',
    );
    expect(layersTrigger).not.toBeNull();

    await act(async () => {
      layersTrigger!.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(LAYERS_CONTENT);
    // The inspector/summary slots are NOT inside the layers Sheet.
    expect(dialog?.textContent).not.toContain(INSPECTOR_CONTENT);
  });

  it("clicking the Show inspector trigger opens a Sheet containing the inspector AND summary slot content", async () => {
    const container = await renderShell();

    const inspectorTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show inspector"]',
    );
    expect(inspectorTrigger).not.toBeNull();

    await act(async () => {
      inspectorTrigger!.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(INSPECTOR_CONTENT);
    expect(dialog?.textContent).toContain(SUMMARY_CONTENT);
    expect(dialog?.textContent).not.toContain(LAYERS_CONTENT);
  });

  it("(d) the CANVAS slot content is always present, regardless of Sheet state", async () => {
    const container = await renderShell();
    expect(container.textContent).toContain(CANVAS_CONTENT);

    const layersTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show layers"]',
    );
    await act(async () => {
      layersTrigger!.click();
    });

    expect(container.textContent).toContain(CANVAS_CONTENT);
  });

  it("existing toolbar behavior is unchanged when onOpenLayers/onOpenInspector are omitted (no mobile triggers rendered)", async () => {
    const { CanvasToolbar } = await import("../canvas-toolbar");
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CanvasToolbar
          mode="select"
          onModeChange={() => undefined}
          showRegions={false}
          onShowRegionsChange={() => undefined}
          showHistory={false}
          onShowHistoryChange={() => undefined}
          showUnrelated={false}
          onShowUnrelatedChange={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Show layers"]')).toBeNull();
    expect(container.querySelector('[aria-label="Show inspector"]')).toBeNull();
    expect(container.querySelector('[aria-label="Close document preview"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Select tool (V)"]')).not.toBeNull();
  });
});
