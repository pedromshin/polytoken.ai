/**
 * retheme-control.test.tsx — RethemeControl (PANL-04, 52-06-PLAN.md Task 1):
 * typing beyond 280 chars is capped and the `{n}/280` counter reflects the
 * current length; Apply with a mocked `{ ok:true, stylePackId, tokenOverrides }`
 * result calls `writeOverlay` with a `retheme` version carrying that pack +
 * overrides + the UNCHANGED `activeSpecJson`, and fires the exact success
 * toast; a mocked `{ ok:false }` result renders the exact inline banner,
 * never calls `writeOverlay`, and preserves the typed instruction (no
 * partial/silent apply); the trigger is disabled while `isLocked`.
 *
 * `~/trpc/react`'s `api.genui.resolveRetheme.useQuery` is mocked (no live
 * tRPC/QueryClient mounted in this test package — mirrors
 * regenerate-control.test.tsx's identical `genui.generate.useQuery` mock
 * convention, since `resolveRetheme` is also a `.query()` procedure). Real
 * `createCanvasStore`/`CanvasStoreProvider`/`CanvasPersistenceProvider`
 * (mirrors `pack-switcher.test.tsx`'s zero-mock convention for the overlay
 * itself) — only `sonner`'s `toast` is mocked. `PopoverContent` renders
 * through a Radix Portal to `document.body` (mirrors
 * `edit-params-control.test.tsx`).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RethemeResult {
  readonly ok: boolean;
  readonly stylePackId?: string;
  readonly tokenOverrides?: Record<string, string>;
  readonly reason?: string;
}

interface RefetchResult {
  readonly data?: RethemeResult;
}

let refetchImpl: () => Promise<RefetchResult> = async () => ({ data: undefined });
const refetchSpy = vi.fn(() => refetchImpl());
const resolveRethemeUseQuerySpy = vi.fn(
  (
    _input: { instruction: string; currentStylePackId?: string },
    _opts?: { enabled?: boolean },
  ) => ({
    refetch: refetchSpy,
  }),
);

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock("~/trpc/react", () => ({
  api: {
    genui: {
      resolveRetheme: {
        useQuery: (
          input: { instruction: string; currentStylePackId?: string },
          opts?: { enabled?: boolean },
        ) => resolveRethemeUseQuerySpy(input, opts),
      },
    },
  },
}));

import { TooltipProvider } from "@polytoken/ui/tooltip";

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { RethemeControl } from "../controls/retheme-control";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVENANCE: Provenance = {
  messageId: "00000000-0000-0000-0000-0000000000b2",
  partIndex: 0,
  runId: null,
};

const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const ACTIVE_SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: "Hello" } });

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

function makeHarness() {
  const store = createCanvasStore();
  const persistenceValue: CanvasPersistenceContextValue = {
    scheduleSave: vi.fn(),
    conversationId: CONVERSATION_ID,
  };
  return { store, persistenceValue };
}

interface OverlayVersion {
  readonly generatedBy: string;
  readonly specJson: string;
  readonly stylePackId?: string;
  readonly tokenOverrides?: Record<string, string>;
  readonly instruction?: string;
}

function overlayVersions(store: ReturnType<typeof createCanvasStore>): OverlayVersion[] {
  const values = store.getState().values as {
    shared?: { panelOverlays?: Record<string, { versions?: OverlayVersion[] }> };
  };
  return values.shared?.panelOverlays?.["panel-a"]?.versions ?? [];
}

function renderControl(isLocked = false) {
  const { store, persistenceValue } = makeHarness();
  const element = (
    <CanvasStoreProvider store={store}>
      <CanvasPersistenceProvider value={persistenceValue}>
        <TooltipProvider delayDuration={300}>
          <RethemeControl
            panelId="panel-a"
            provenance={PROVENANCE}
            activeSpecJson={ACTIVE_SPEC_JSON}
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
  const trigger = container.querySelector('[aria-label="Re-theme"]');
  expect(trigger).not.toBeNull();
  await act(async () => {
    (trigger as HTMLButtonElement).click();
  });
}

function findButton(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  return (buttons.find((b) => b.textContent === text) as HTMLButtonElement) ?? null;
}

function setTextareaValue(el: HTMLTextAreaElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  resolveRethemeUseQuerySpy.mockClear();
  refetchSpy.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  refetchImpl = async () => ({ data: undefined });
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

describe("RethemeControl", () => {
  // Test 1
  it("typing beyond 280 chars is capped by the component and the counter reflects the capped length", async () => {
    const { element } = renderControl();
    const container = await mount(element);
    await openPopover(container);

    const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.maxLength).toBe(280);

    await act(async () => {
      setTextareaValue(textarea, "Make it playful");
    });
    expect(document.body.textContent).toContain(`${"Make it playful".length}/280`);

    const overLong = "x".repeat(300);
    await act(async () => {
      setTextareaValue(textarea, overLong);
    });

    expect(textarea.value).toHaveLength(280);
    expect(document.body.textContent).toContain("280/280");
  });

  // Test 2
  it("Apply with a mocked ok:true result calls writeOverlay with a retheme version carrying the pack + overrides + unchanged specJson, and fires the success toast", async () => {
    refetchImpl = async () => ({
      data: {
        ok: true,
        stylePackId: "playful-rounded",
        tokenOverrides: { primary: "262 83% 58%" },
      },
    });

    const { store, element } = renderControl();
    const container = await mount(element);
    await openPopover(container);

    const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(textarea, "Make it feel more playful and colorful");
    });

    const applyButton = findButton("Apply look");
    expect(applyButton).not.toBeNull();
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton?.click();
    });

    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(resolveRethemeUseQuerySpy).toHaveBeenCalledWith(
      { instruction: "Make it feel more playful and colorful", currentStylePackId: "polytoken-teal" },
      { enabled: false },
    );

    const versions = overlayVersions(store);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.generatedBy).toBe("retheme");
    expect(versions[0]?.stylePackId).toBe("playful-rounded");
    expect(versions[0]?.tokenOverrides).toEqual({ primary: "262 83% 58%" });
    expect(versions[0]?.specJson).toBe(ACTIVE_SPEC_JSON);
    expect(versions[0]?.instruction).toBe("Make it feel more playful and colorful");

    expect(toastSuccess).toHaveBeenCalledWith("Panel re-themed");
    expect(toastError).not.toHaveBeenCalled();

    // Popover closes on success — portaled content unmounts.
    expect(document.body.querySelector("textarea")).toBeNull();
  });

  // Test 3
  it("a mocked ok:false result renders the exact inline banner, never calls writeOverlay, and preserves the typed instruction", async () => {
    refetchImpl = async () => ({ data: { ok: false, reason: "malformed" } });

    const { store, element } = renderControl();
    const container = await mount(element);
    await openPopover(container);

    const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(textarea, "Attempted instruction");
    });

    const applyButton = findButton("Apply look");
    await act(async () => {
      applyButton?.click();
    });

    const banner = document.body.querySelector('[role="alert"]');
    expect(banner?.textContent).toBe("Couldn't apply that look — try describing it differently.");

    expect(overlayVersions(store)).toHaveLength(0);
    expect(toastSuccess).not.toHaveBeenCalled();

    // Popover stays open, typed instruction preserved — no partial apply.
    expect((document.body.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Attempted instruction",
    );
  });

  // Test 4
  it("the trigger is disabled while isLocked", async () => {
    const { element } = renderControl(true);
    const container = await mount(element);

    const trigger = container.querySelector('[aria-label="Re-theme"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
