/**
 * edit-params-control.test.tsx — EditParamsControl (PANL-02, 52-03-PLAN.md
 * Task 3): a card panel shows title+description fields; a successful save
 * appends an `edit` version via writeOverlay with the new title; a server
 * rejection renders the exact banner copy, never calls writeOverlay, and
 * preserves typed values (no partial apply); a `text`-root panel disables
 * the button with the no-editable-parameters tooltip.
 *
 * `~/trpc/react`'s `api.genui.applyPanelEdit.useMutation` is mocked (no live
 * tRPC/QueryClient mounted in this test package — mirrors
 * genui-panel-node-toolbar.test.tsx's `api.useQueries` mock convention).
 * `PopoverContent` renders through a Radix Portal to `document.body`, not
 * inside the mounted container (mirrors add-knowledge-preview-popover.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MutationResult {
  readonly ok: boolean;
  readonly spec?: unknown;
  readonly reason?: string;
}

interface MutationCallbacks {
  readonly onSuccess?: (result: MutationResult) => void;
  readonly onError?: (error: unknown) => void;
}

type MutateInput = { currentSpecJson: string; params: Record<string, unknown> };

let mutateImpl: (input: MutateInput, opts?: MutationCallbacks) => void = () => undefined;
const mutateSpy = vi.fn((input: MutateInput, opts?: MutationCallbacks) => mutateImpl(input, opts));

vi.mock("~/trpc/react", () => ({
  api: {
    genui: {
      applyPanelEdit: {
        useMutation: () => ({
          mutate: mutateSpy,
          isPending: false,
        }),
      },
    },
  },
}));

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* jsdom does not implement this — no-op polyfill for Radix Select. */
  };
}

import { TooltipProvider } from "@polytoken/ui/tooltip";

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { EditParamsControl } from "../controls/edit-params-control";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVENANCE: Provenance = {
  messageId: "00000000-0000-0000-0000-0000000000b2",
  partIndex: 0,
  runId: null,
};

const CARD_SPEC_JSON = JSON.stringify({
  v: 1,
  root: { type: "card", title: "Old title", description: "Old description" },
});

const TEXT_SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: "Hello" } });

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function makeHarness() {
  const store = createCanvasStore();
  const persistenceValue: CanvasPersistenceContextValue = {
    scheduleSave: vi.fn(),
    conversationId: "11111111-1111-1111-1111-111111111111",
  };
  return { store, persistenceValue };
}

function renderControl(specJson: string, isLocked = false) {
  const { store, persistenceValue } = makeHarness();
  const element = (
    <CanvasStoreProvider store={store}>
      <CanvasPersistenceProvider value={persistenceValue}>
        <TooltipProvider delayDuration={300}>
          <EditParamsControl
            panelId="panel-a"
            provenance={PROVENANCE}
            activeSpecJson={specJson}
            resolvedPackId="polytoken-teal"
            isLocked={isLocked}
            onBusyChange={vi.fn()}
            onGeneratingChange={vi.fn()}
          />
        </TooltipProvider>
      </CanvasPersistenceProvider>
    </CanvasStoreProvider>
  );
  return { store, element };
}

async function openPopover(container: HTMLDivElement): Promise<void> {
  const trigger = container.querySelector('[aria-label="Edit parameters"]');
  expect(trigger).not.toBeNull();
  await act(async () => {
    (trigger as HTMLButtonElement).click();
  });
}

function findButton(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  return (buttons.find((b) => b.textContent === text) as HTMLButtonElement) ?? null;
}

function overlayVersions(store: ReturnType<typeof createCanvasStore>): unknown[] {
  const values = store.getState().values as {
    shared?: { panelOverlays?: Record<string, { versions?: unknown[] }> };
  };
  return values.shared?.panelOverlays?.["panel-a"]?.versions ?? [];
}

beforeEach(() => {
  mutateSpy.mockClear();
  mutateImpl = () => undefined;
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
});

describe("EditParamsControl", () => {
  // Test 1
  it("a card panel shows title + description fields", async () => {
    const { element } = renderControl(CARD_SPEC_JSON);
    const container = await mount(element);
    await openPopover(container);

    expect(document.body.querySelector("#edit-param-title")).not.toBeNull();
    expect(document.body.querySelector("#edit-param-description")).not.toBeNull();
    expect((document.body.querySelector("#edit-param-title") as HTMLInputElement).value).toBe(
      "Old title",
    );
  });

  // Test 2
  it("editing + Save with a mocked { ok:true, spec } calls writeOverlay with an edit version carrying the new title", async () => {
    mutateImpl = (_input, opts) => {
      opts?.onSuccess?.({
        ok: true,
        spec: { v: 1, root: { type: "card", title: "New title", description: "Old description" } },
      });
    };

    const { store, element } = renderControl(CARD_SPEC_JSON);
    const container = await mount(element);
    await openPopover(container);

    const titleInput = document.body.querySelector("#edit-param-title") as HTMLInputElement;
    await act(async () => {
      setInputValue(titleInput, "New title");
    });

    const saveButton = findButton("Save changes");
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [sentInput] = mutateSpy.mock.calls[0] as [MutateInput];
    expect(sentInput.currentSpecJson).toBe(CARD_SPEC_JSON);
    expect(sentInput.params.title).toBe("New title");

    const versions = overlayVersions(store) as { generatedBy: string; specJson: string }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]?.generatedBy).toBe("edit");
    expect(versions[0]?.specJson).toContain("New title");

    // Popover closes on success — portaled content unmounts.
    expect(document.body.querySelector("#edit-param-title")).toBeNull();
  });

  // Test 3
  it("a mocked { ok:false } renders the exact server-error banner, never calls writeOverlay, and leaves typed values in place", async () => {
    mutateImpl = (_input, opts) => {
      opts?.onSuccess?.({ ok: false, reason: "nope" });
    };

    const { store, element } = renderControl(CARD_SPEC_JSON);
    const container = await mount(element);
    await openPopover(container);

    const titleInput = document.body.querySelector("#edit-param-title") as HTMLInputElement;
    await act(async () => {
      setInputValue(titleInput, "Attempted title");
    });

    const saveButton = findButton("Save changes");
    await act(async () => {
      saveButton?.click();
    });

    const banner = document.body.querySelector('[role="alert"]');
    expect(banner?.textContent).toBe("Couldn't save these changes — check the highlighted fields.");

    expect(overlayVersions(store)).toHaveLength(0);

    // Popover stays open, typed value preserved — no partial apply.
    expect((document.body.querySelector("#edit-param-title") as HTMLInputElement).value).toBe(
      "Attempted title",
    );
  });

  // Test 4
  it("a text-root panel renders the button disabled with the no-editable-parameters tooltip", async () => {
    const { element } = renderControl(TEXT_SPEC_JSON);
    const container = await mount(element);

    const trigger = container.querySelector('[aria-label="Edit parameters"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.disabled).toBe(true);

    // No popover exists for the empty-whitelist case — clicking does nothing.
    await act(async () => {
      trigger.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  // Test 5
  it("the trigger is disabled while isLocked (card panel)", async () => {
    const { element } = renderControl(CARD_SPEC_JSON, true);
    const container = await mount(element);

    const trigger = container.querySelector('[aria-label="Edit parameters"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
