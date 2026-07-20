/**
 * allowlist.test.tsx — pins the client-persisted allowlist's contract (the storage-backend seam).
 *
 * What is load-bearing here:
 *   - DEFAULT ALLOWED IS STRUCTURAL: the store records denials only, so an id never seen
 *     (including a capability that registers tomorrow) is allowed without a store migration.
 *   - toggling off persists `id -> false` under the versioned key; toggling back on DELETES
 *     the key (the store never accumulates `true`s).
 *   - corrupt/foreign storage values degrade to "nothing denied", never a crash.
 *
 * When the server-persisted `capabilities.allowlist` procedures land, this file is the spec the
 * swapped backend must keep honoring through the same hook surface.
 *
 * Harness: jsdom + createRoot + `act` from "react" — this app's real test convention
 * (`vault-states.test.tsx` header: `@testing-library/react` is NOT a dependency of this repo).
 */
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCapabilityAllowlist, type CapabilityAllowlist } from "../_lib/allowlist";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = "polytoken.capability-allowlist.v1";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: CapabilityAllowlist | null;

function Probe(): null {
  latest = useCapabilityAllowlist();
  return null;
}

function mountHook(): void {
  act(() => root.render(<Probe />));
}

beforeEach(() => {
  window.localStorage.clear();
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function current(): CapabilityAllowlist {
  if (latest === null) throw new Error("hook not mounted");
  return latest;
}

describe("useCapabilityAllowlist", () => {
  it("defaults every id to allowed after hydration", () => {
    mountHook();
    expect(current().hydrated).toBe(true);
    expect(current().isAllowed("fs.read")).toBe(true);
    expect(current().isAllowed("never-seen-before")).toBe(true);
    expect(current().deniedCount).toBe(0);
  });

  it("persists a denial and restores it on a fresh mount", () => {
    mountHook();
    act(() => current().setAllowed("terminal.exec", false));
    expect(current().isAllowed("terminal.exec")).toBe(false);
    expect(current().deniedCount).toBe(1);

    // Fresh mount — state must come back from storage, not component memory.
    act(() => root.unmount());
    root = createRoot(container);
    latest = null;
    mountHook();

    expect(current().isAllowed("terminal.exec")).toBe(false);
    expect(current().isAllowed("fs.read")).toBe(true);
  });

  it("re-allowing deletes the key — the store holds denials only", () => {
    mountHook();
    act(() => current().setAllowed("git", false));
    act(() => current().setAllowed("git", true));

    expect(current().isAllowed("git")).toBe(true);
    expect(current().deniedCount).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("degrades corrupt storage to nothing-denied instead of crashing", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json at all {{{");
    mountHook();
    expect(current().hydrated).toBe(true);
    expect(current().isAllowed("fs.write")).toBe(true);
    expect(current().deniedCount).toBe(0);
  });

  it("ignores non-false values smuggled into the store shape", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "fs.read": true, "fs.write": "false", git: false }),
    );
    mountHook();
    expect(current().isAllowed("fs.read")).toBe(true);
    expect(current().isAllowed("fs.write")).toBe(true); // string "false" is not a denial
    expect(current().isAllowed("git")).toBe(false);
    expect(current().deniedCount).toBe(1);
  });
});
