/**
 * use-model-settings.test.tsx — the per-conversation reasoning dials store
 * (task #4, FAB write-through). jsdom-only: pure helpers + hook behaviour via
 * react-dom/client + act (mirrors chat-quick-actions-fab.test.tsx's mount
 * convention; no @testing-library in this workspace).
 *
 * Proves the single-source-of-truth contract: what setMode/setEffort WRITE is
 * exactly what a later read (a fresh mount, i.e. the send path re-reading the
 * same conversation) OBSERVES — there is no second store the model call could
 * diverge from.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsStorageKey,
  parseStoredModelSettings,
  serializeModelSettings,
  useModelSettings,
  type UseModelSettingsResult,
} from "../use-model-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CONV_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONV_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("parseStoredModelSettings", () => {
  it("returns the default for a null / malformed / non-object value", () => {
    expect(parseStoredModelSettings(null)).toEqual(DEFAULT_MODEL_SETTINGS);
    expect(parseStoredModelSettings("{not json")).toEqual(
      DEFAULT_MODEL_SETTINGS,
    );
    expect(parseStoredModelSettings("42")).toEqual(DEFAULT_MODEL_SETTINGS);
    expect(parseStoredModelSettings("null")).toEqual(DEFAULT_MODEL_SETTINGS);
  });

  it("degrades an out-of-domain field to its default but keeps the valid one", () => {
    expect(
      parseStoredModelSettings(
        JSON.stringify({ mode: "wat", effort: "high" }),
      ),
    ).toEqual({ mode: DEFAULT_MODEL_SETTINGS.mode, effort: "high" });
    expect(
      parseStoredModelSettings(
        JSON.stringify({ mode: "thinking", effort: "nope" }),
      ),
    ).toEqual({ mode: "thinking", effort: DEFAULT_MODEL_SETTINGS.effort });
  });

  it("round-trips a fully valid value through serialize", () => {
    const value = { mode: "thinking", effort: "low" } as const;
    expect(parseStoredModelSettings(serializeModelSettings(value))).toEqual(
      value,
    );
  });

  it("keys storage per conversation id", () => {
    expect(modelSettingsStorageKey(CONV_A)).not.toBe(
      modelSettingsStorageKey(CONV_B),
    );
    expect(modelSettingsStorageKey(CONV_A)).toContain(CONV_A);
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;
let latest: UseModelSettingsResult;

function Probe({ conversationId }: { conversationId: string | null }): null {
  latest = useModelSettings(conversationId);
  return null;
}

async function render(conversationId: string | null): Promise<void> {
  await act(async () => {
    root.render(<Probe conversationId={conversationId} />);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  window.localStorage.clear();
});

describe("useModelSettings", () => {
  it("starts at the default when nothing is stored", async () => {
    await render(CONV_A);
    expect(latest.settings).toEqual(DEFAULT_MODEL_SETTINGS);
  });

  it("setMode/setEffort update state AND persist, so a fresh mount (the send path re-read) sees the same value", async () => {
    await render(CONV_A);
    await act(async () => {
      latest.setMode("thinking");
    });
    await act(async () => {
      latest.setEffort("high");
    });
    expect(latest.settings).toEqual({ mode: "thinking", effort: "high" });

    // What was WRITTEN is what a later reader OBSERVES — the model call reads
    // this exact store, so there is no second source of truth to diverge.
    const persisted = window.localStorage.getItem(
      modelSettingsStorageKey(CONV_A),
    );
    expect(parseStoredModelSettings(persisted)).toEqual({
      mode: "thinking",
      effort: "high",
    });
  });

  it("re-reads the target conversation's dials when the id changes", async () => {
    window.localStorage.setItem(
      modelSettingsStorageKey(CONV_B),
      serializeModelSettings({ mode: "thinking", effort: "low" }),
    );
    await render(CONV_A);
    expect(latest.settings).toEqual(DEFAULT_MODEL_SETTINGS);
    await render(CONV_B);
    expect(latest.settings).toEqual({ mode: "thinking", effort: "low" });
  });

  it("no-ops the setters when there is no conversation (null id) — never writes storage", async () => {
    await render(null);
    expect(latest.settings).toEqual(DEFAULT_MODEL_SETTINGS);
    await act(async () => {
      latest.setMode("thinking");
      latest.setEffort("high");
    });
    expect(latest.settings).toEqual(DEFAULT_MODEL_SETTINGS);
    expect(window.localStorage.length).toBe(0);
  });
});
