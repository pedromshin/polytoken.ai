import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@polytoken/ui/sidebar";

/**
 * sidebar-overlay-regression.test.tsx — the structural pin for backlog 999.21
 * (sidebar pointer-events interception; lane w65-sidebar-fix root-cause).
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT ACTUALLY HAPPENED (root cause, from source + git archaeology)
 * ────────────────────────────────────────────────────────────────────────
 *
 * The desktop `Sidebar` (packages/ui/src/sidebar.tsx) renders TWO width-paired
 * siblings inside its `data-side="left"` wrapper:
 *
 *   1. an in-flow GAP SPACER (`relative h-svh w-(--sidebar-width) ...`) whose
 *      only job is to RESERVE the sidebar's width in the flex row so
 *      `SidebarInset` (the app content) starts to its right, and
 *   2. a FIXED OVERLAY PANEL (`fixed inset-y-0 z-10 ... w-(--sidebar-width)`)
 *      that paints the actual sidebar chrome (`data-sidebar="sidebar"` >
 *      `"content"` > `"menu"`) on top of that reserved strip.
 *
 * Between `9333f291` (55-01, the Tailwind v4 engine swap) and `db8da425`
 * (2026-07-15, "sidebar was half-width"), both widths were spelled in the
 * Tailwind v3-only bare-var arbitrary form (`w-[--sidebar-width]`), which the
 * v4 engine SILENTLY compiles to nothing — no build error, no console error,
 * the class token is simply absent from the emitted CSS. With no width:
 *
 *   - the empty gap spacer computed to 0px, so ALL content shifted left to
 *     x=0, and
 *   - the fixed panel shrink-wrapped to its intrinsic ~128px and kept
 *     painting at z-10 OVER the leftmost strip of every surface.
 *
 * Playwright's actionability hit-test at any click point inside that strip
 * then resolved to the sidebar's `data-sidebar="content"`/`"menu"` subtree
 * instead of the intended target — the exact "<div data-sidebar=\"content\">
 * ... intercepts pointer events" retry-until-timeout signature recorded in
 * 55-02/55-04/55-05 and 55-VERIFICATION against three independent left-edge
 * targets (/knowledge's filter rail, /emails/[id]'s layers panel, /studio's
 * tabs). Every documented repro ran inside that window; the "pre-existing
 * since v1.9" note in the backlog does not survive contact with the v1.9
 * §G.2 debug record (.planning/debug/resolved/e2e-regressions-51-07.md: 7
 * failures, 4 root causes, none of them interception, suite green 32/32
 * twice on the v3 engine), and 55-02's revert-and-reproduce bisection only
 * went back to the 55-01 state — which already carried the v4 engine and the
 * broken classes, so "reproduced on baseline" indicted the wrong commit.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUITE PINS, AND WHAT IT HONESTLY CANNOT
 * ────────────────────────────────────────────────────────────────────────
 *
 * jsdom does no layout: no width here is ever a number, and this file cannot
 * prove the overlay is gone in a real browser — that proof lives at the
 * rendered-geometry/BURN-01 layer (see apps/web/e2e/surface-geometry.spec.ts,
 * whose header names this very bug as one of the four that shipped through
 * green suites). A class-token assertion IS the correct level for THIS pin,
 * because the defect was itself a class-token defect: the classes present
 * were well-formed v3, and the only source-visible symptom is the syntax.
 * So this suite pins, at the level the regression actually lives:
 *
 *   1. the gap spacer and the fixed panel BOTH carry the v4 width tokens, as
 *      an exact pair — the interception geometry arises precisely when the
 *      pair disagrees (the panel keeps painting while the spacer stops
 *      reserving);
 *   2. the historical interceptor (`data-sidebar="content"`) is a descendant
 *      of the fixed panel whose widths are pinned — documenting WHICH box
 *      the pin protects;
 *   3. no element under the sidebar shell carries the v3 bare-var syntax;
 *   4. (source walk, role-hue-ban idiom) no file in packages/ui/src spells
 *      ANY utility in the v3 bare-var form — the re-vendor hazard: upstream
 *      shadcn snippets still circulate in v3 spelling, and pasting one back
 *      re-opens 999.21 with zero red output anywhere else.
 */

// ---------------------------------------------------------------------------
// jsdom scaffolding — mirrors use-is-mobile-viewport.test.ts's stub idiom
// (the shape sidebar.tsx's useIsMobile() subscribes to), including this
// workspace's zero-mock createRoot-in-jsdom convention.
// ---------------------------------------------------------------------------

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ChangeHandler = (event: { matches: boolean }) => void;

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
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

/** Desktop: `(max-width: 767px)` does not match, so `Sidebar` takes its
 * two-sibling desktop branch rather than the mobile Sheet. */
function mountDesktopSidebar(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(
      (query: string) => new FakeMediaQueryList(query, false),
    ),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    // Exactly how the app shell configures it (src/app/layout.tsx +
    // src/components/app-sidebar.tsx): default-open provider, icon-collapsible
    // left sidebar, content inside SidebarContent.
    root?.render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <span>nav goes here</span>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
  });
}

beforeEach(() => {
  mountDesktopSidebar();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The two width-paired siblings
// ---------------------------------------------------------------------------

function shell(): HTMLElement {
  const el = container?.querySelector<HTMLElement>('[data-side="left"]');
  expect(el, "the desktop sidebar shell ([data-side=left]) did not render").not.toBeNull();
  return el as HTMLElement;
}

function gapSpacer(): HTMLElement {
  return shell().children[0] as HTMLElement;
}

function fixedPanel(): HTMLElement {
  return shell().children[1] as HTMLElement;
}

function classTokens(el: HTMLElement): readonly string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter((t) => t.length > 0);
}

/**
 * The v3 bare-var arbitrary-value spelling: a utility prefix whose bracket
 * value OPENS with a bare custom property (`…-[--foo]`). Valid v4 spellings
 * never look like this: the shorthand is `…-(--foo)` and the longhand wraps
 * the property (`…-[var(--foo)]` / `…-[calc(var(--foo)…)]`). Arbitrary
 * PROPERTIES (`[--foo:bar]`) and data-variants (`data-[state=…]`) are not
 * matched: both lack the `<utility>-[--` shape.
 */
const V3_BARE_VAR_PATTERN = /\b[a-z][a-zA-Z0-9-]*-\[--/;

describe("sidebar overlay regression pin (999.21 / db8da425)", () => {
  it("renders the desktop shell expanded with both width-paired siblings", () => {
    expect(shell().getAttribute("data-state")).toBe("expanded");
    // Two siblings: the in-flow gap spacer, then the fixed overlay panel.
    expect(shell().children.length).toBe(2);
    expect(classTokens(gapSpacer())).toContain("relative");
    expect(classTokens(fixedPanel())).toContain("fixed");
  });

  it("the gap spacer RESERVES the same width tokens the fixed panel PAINTS (the pair may never disagree)", () => {
    const spacerTokens = classTokens(gapSpacer());
    const panelTokens = classTokens(fixedPanel());

    // Expanded width — the token whose v3 spelling silently vanished under
    // the v4 engine and produced the ~128px overlay over content at x=0.
    for (const [label, tokens] of [
      ["gap spacer", spacerTokens],
      ["fixed panel", panelTokens],
    ] as const) {
      expect(
        tokens,
        `${label} lost its expanded width token "w-(--sidebar-width)" — if the pair disagrees, ` +
          "the fixed z-10 panel paints over content the spacer no longer reserves room for, " +
          "and every click in that strip lands on data-sidebar=\"content\" instead of its " +
          "target (999.21's exact signature)",
      ).toContain("w-(--sidebar-width)");

      // Icon-collapsed width — same pairing, same failure mode at 3rem.
      expect(
        tokens,
        `${label} lost its icon-collapsed width token — the collapsed pair must agree for the ` +
          "same reason the expanded pair must",
      ).toContain("group-data-[collapsible=icon]:w-(--sidebar-width-icon)");
    }

    // The panel really is the painted overlay this pin protects against.
    expect(classTokens(fixedPanel())).toContain("z-10");
    expect(classTokens(fixedPanel())).toContain("left-0");
  });

  it("the historical interceptor (data-sidebar=content) lives INSIDE the width-pinned fixed panel", () => {
    // Documents which box the width pin protects: the element Playwright
    // reported as intercepting ("<div data-sidebar=\"content\"> … intercepts
    // pointer events") is a descendant of the fixed panel — its hit area is
    // bounded by the panel's width, so pinning the panel's width tokens pins
    // the interception surface.
    const interceptor = fixedPanel().querySelector('[data-sidebar="content"]');
    expect(interceptor, "data-sidebar=\"content\" is no longer inside the fixed panel — " +
      "re-anchor this pin to wherever the sidebar's scrollable nav moved").not.toBeNull();
  });

  it("no rendered element under the sidebar shell carries the v3 bare-var arbitrary syntax", () => {
    const all = [
      container as HTMLElement,
      ...Array.from((container as HTMLElement).querySelectorAll<HTMLElement>("*")),
    ];
    const offenders = all
      .filter((el) => V3_BARE_VAR_PATTERN.test(el.getAttribute("class") ?? ""))
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`);

    expect(
      offenders,
      `rendered sidebar element(s) carry the Tailwind v3 bare-var arbitrary spelling, which ` +
        `the v4 engine compiles to NOTHING (no error anywhere — see db8da425):\n` +
        offenders.join("\n"),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source walk — packages/ui/src must never re-acquire the v3 spelling
// (role-hue-ban.test.ts's walk idiom; reads LINES, not prose — packages/ui
// source describes the retired spelling rather than naming it, and today it
// does: zero literal occurrences repo-wide outside comments in already-swept
// app surfaces).
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** repo-root/packages/ui/src — the vendored primitive library where the
 * regression lived (sidebar.tsx + chart.tsx, 9 call sites fixed by db8da425). */
const UI_SRC_DIR = path.resolve(__dirname, "../../../../..", "packages", "ui", "src");

const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", "__tests__"]);
const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry)) return [];
      return collectSourceFiles(fullPath);
    }
    return FILE_EXTENSIONS.has(path.extname(entry)) ? [fullPath] : [];
  });
}

describe("v3 bare-var ban across packages/ui/src (the re-vendor hazard)", () => {
  it("the walked root exists and yields files — the gate cannot be made vacuous", () => {
    expect(existsSync(UI_SRC_DIR), `walk root is missing: ${UI_SRC_DIR}`).toBe(true);
    expect(collectSourceFiles(UI_SRC_DIR).length).toBeGreaterThan(0);
  });

  it("no packages/ui source file spells a utility in the v3 bare-var form", () => {
    const violations = collectSourceFiles(UI_SRC_DIR).flatMap((file) => {
      const relPath = path.relative(UI_SRC_DIR, file).split(path.sep).join("/");
      return readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((lineText, index) => {
          const match = lineText.match(V3_BARE_VAR_PATTERN);
          return match ? [`  ${relPath}:${index + 1} -> "${match[0]}…"`] : [];
        });
    });

    expect(
      violations,
      `Found ${violations.length} Tailwind v3 bare-var arbitrary value(s) in packages/ui/src:\n` +
        `${violations.join("\n")}\n\n` +
        `Under the v4 engine these compile to NOTHING — no build error, no console error, the ` +
        `declaration is simply absent. That is how the sidebar shipped half-width through 730 ` +
        `green tests and a 4/4 verification (db8da425), and how its fixed panel came to overlay ` +
        `content and eat clicks (backlog 999.21). Spell it w-(--var) or w-[var(--var)]. If this ` +
        `line is prose, describe the spelling instead of naming it — this gate reads lines.`,
    ).toHaveLength(0);
  });
});
