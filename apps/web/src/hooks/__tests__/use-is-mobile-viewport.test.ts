/**
 * use-is-mobile-viewport.test.ts — RED test for the shared
 * useIsMobileViewport() hook (53-01-PLAN.md Task 1, 53-UI-SPEC.md
 * "Breakpoint & Mount Contract"). Mirrors this codebase's zero-mock
 * createRoot-in-jsdom convention (`genui-panel-node-toolbar.test.tsx` /
 * `panel-data-flow.test.tsx` — no `@testing-library/react` in this
 * workspace): a fake `MediaQueryList` stub for `window.matchMedia` that
 * captures the `change` handler so the test can invoke it directly, plus a
 * `renderToString` pass to prove the hook's pre-effect value never depends
 * on a `window`/`matchMedia` read (SSR-safety, Test 4).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIsMobileViewport } from "../use-is-mobile-viewport";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MOBILE_QUERY = "(max-width: 767px)";

type ChangeHandler = (event: { matches: boolean }) => void;

/** Minimal fake `MediaQueryList` — captures the `change` listener so tests
 * can dispatch synthetic change events directly, matching the shape
 * `packages/ui/src/sidebar.tsx`'s `useIsMobile()` subscribes to. */
class FakeMediaQueryList {
  matches: boolean;
  readonly media: string;
  private readonly listeners = new Set<ChangeHandler>();

  constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  addEventListener(type: string, handler: ChangeHandler): void {
    if (type === "change") this.listeners.add(handler);
  }

  removeEventListener(type: string, handler: ChangeHandler): void {
    if (type === "change") this.listeners.delete(handler);
  }

  dispatchChange(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches }));
  }
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let mql: FakeMediaQueryList | undefined;
let latestValue: boolean | undefined;

function Consumer(): React.ReactElement {
  latestValue = useIsMobileViewport();
  return React.createElement("span", null, String(latestValue));
}

function mountWithMatches(initialMatches: boolean): void {
  mql = new FakeMediaQueryList(MOBILE_QUERY, initialMatches);
  const currentMql = mql;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => {
      expect(query).toBe(MOBILE_QUERY);
      return currentMql;
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(React.createElement(Consumer));
  });
}

beforeEach(() => {
  latestValue = undefined;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  mql = undefined;
  vi.unstubAllGlobals();
});

describe("useIsMobileViewport", () => {
  it("returns false after mount when matchMedia reports matches:false (>=768px)", () => {
    mountWithMatches(false);
    expect(latestValue).toBe(false);
  });

  it("returns true after mount when matchMedia reports matches:true (<768px)", () => {
    mountWithMatches(true);
    expect(latestValue).toBe(true);
  });

  it("updates when the media query list's change event fires with a new matches value", () => {
    mountWithMatches(false);
    expect(latestValue).toBe(false);

    act(() => {
      mql?.dispatchChange(true);
    });
    expect(latestValue).toBe(true);

    act(() => {
      mql?.dispatchChange(false);
    });
    expect(latestValue).toBe(false);
  });

  it("SSR-safe: the pre-effect render never reads matchMedia and resolves to false", () => {
    // renderToString runs only the synchronous render pass (no effects) —
    // if the hook read `window.matchMedia` outside `useEffect`, this spy
    // would be called during this render; it must not be.
    const matchMediaSpy = vi
      .fn()
      .mockImplementation(
        (query: string) => new FakeMediaQueryList(query, true),
      );
    vi.stubGlobal("matchMedia", matchMediaSpy);

    const html = renderToString(React.createElement(Consumer));

    expect(html).toContain("false");
    expect(matchMediaSpy).not.toHaveBeenCalled();
  });
});
