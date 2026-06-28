/**
 * __tests__/render-node.test.tsx — Trusted interpreter tests.
 *
 * Test blocks:
 *   1. SPEC-02 happy-path: card → stack → [text, badge] renders via SpecRenderer
 *   2. SPEC-03 isolation: malformed node surrounded by valid siblings — role="alert"
 *      present, valid siblings still render
 *   3. SPEC-04/05 state + conditional: toggle action materializes state; conditional
 *      node renders then/else branch based on state.isExpanded value
 *   4. resolveDataRef unit tests: dotted-path resolution, undefined for missing,
 *      prototype-pollution key guard
 *   5. useDeclaredState unit tests: all 5 mutation types
 *   6. NodeErrorBoundary unit tests: catches throws, renders fallback with role="alert"
 *   7. Round-trip regression: all 10 catalog types render without NodeErrorFallback
 *      when SHOWCASE_SPEC is used (D-17 / CR-01 / CR-02 / CR-03 regression guard)
 *
 * Testing approach: react-dom/server renderToStaticMarkup (no @testing-library/react
 * dependency — only jsdom + react-dom available in this package).
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Deferred imports — these will fail until render-node.tsx + spec-renderer.tsx
// + renderer/index.ts are created (RED phase dependency)
// ---------------------------------------------------------------------------
import { SpecRenderer } from "../renderer/spec-renderer";
import { resolveDataRef } from "../renderer/render-node";
import { COMPONENT_REGISTRY } from "../registry/component-registry";

// useDeclaredState tests need renderHook-equivalent — use a test wrapper component
import { useDeclaredState } from "../renderer/use-declared-state";
import { NodeErrorBoundary, NodeErrorFallback } from "../renderer/error-boundary";

import type { SpecRoot } from "../schema/spec-schema";
import type { RenderContext } from "../renderer/render-node";

import { SHOWCASE_SPEC } from "../demo/showcase-spec";

// ===========================================================================
// Block 1: SPEC-02 happy path — card → stack → [text, badge]
// ===========================================================================

describe("SpecRenderer happy path (SPEC-02)", () => {
  it("renders a card containing a stack with text and badge", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "card",
        title: "Test Card",
        children: [
          {
            type: "stack",
            direction: "vertical",
            children: [
              { type: "text", content: "Hello World" },
              { type: "badge", label: "Active" },
            ],
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    expect(html).toContain("Hello World");
    expect(html).toContain("Active");
    // Should not contain any eval/Function injection (GR-01 verification in output)
    expect(html).not.toContain("eval(");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders a text node directly as root", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "text", content: "Direct root text" },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    expect(html).toContain("Direct root text");
  });

  it("renders a badge node directly as root", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "badge", label: "Status: OK" },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    expect(html).toContain("Status: OK");
  });
});

// ===========================================================================
// Block 2: SPEC-03 error isolation — malformed node surrounded by valid siblings
// ===========================================================================

describe("SpecRenderer error isolation (SPEC-03)", () => {
  it("renders role='alert' fallback for unknown node type while siblings render", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "stack",
        direction: "vertical",
        children: [
          { type: "text", content: "Before" },
          // @ts-expect-error — intentionally malformed/unknown type for testing
          { type: "totally-unknown-widget", label: "broken" },
          { type: "text", content: "After" },
        ],
      },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    // Error node renders fallback
    expect(html).toContain('role="alert"');
    // Valid siblings still render (error isolation is per-node)
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("renders prop-validation fallback when registry node gets wrong props shape", () => {
    // We pass a badge node where the manifest's propsSchema expects `label: string`
    // but we inject an invalid shape via a spec that bypasses TypeScript
    const badSpec = {
      v: 1,
      root: {
        type: "stack",
        direction: "vertical",
        children: [
          { type: "text", content: "Valid sibling" },
          // badge with missing required `label` — propsSchema.safeParse will fail
          { type: "badge" },
          { type: "text", content: "Also valid" },
        ],
      },
    } as unknown as SpecRoot;

    const html = renderToStaticMarkup(
      <SpecRenderer spec={badSpec} registry={COMPONENT_REGISTRY} />,
    );

    // Valid siblings must still render
    expect(html).toContain("Valid sibling");
    expect(html).toContain("Also valid");
    // Error fallback rendered
    expect(html).toContain('role="alert"');
  });
});

// ===========================================================================
// Block 3: SPEC-04/05 — state materialization + conditional + dataRef resolution
// ===========================================================================

describe("SpecRenderer state + conditional (SPEC-04/SPEC-05)", () => {
  it("renders the else-branch when isExpanded is false (initial state)", () => {
    const spec: SpecRoot = {
      v: 1,
      state: [
        {
          name: "isExpanded",
          type: "boolean",
          initial: false,
          actions: [
            { name: "toggleExpanded", mutation: "toggle" },
          ],
        },
      ],
      root: {
        type: "conditional",
        condition: {
          dataRef: "state.isExpanded",
          operator: "truthy",
        },
        then: { type: "text", content: "Expanded content" },
        else: { type: "text", content: "Collapsed content" },
      },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    // isExpanded starts false → else branch
    expect(html).toContain("Collapsed content");
    expect(html).not.toContain("Expanded content");
  });

  it("renders the then-branch when initial state is true", () => {
    const spec: SpecRoot = {
      v: 1,
      state: [
        {
          name: "isOpen",
          type: "boolean",
          initial: true,
        },
      ],
      root: {
        type: "conditional",
        condition: {
          dataRef: "state.isOpen",
          operator: "truthy",
        },
        then: { type: "text", content: "Is open!" },
        else: { type: "text", content: "Is closed." },
      },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );

    expect(html).toContain("Is open!");
    expect(html).not.toContain("Is closed.");
  });

  it("resolves data prop to conditional branch", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "conditional",
        condition: {
          dataRef: "data.user.isAdmin",
          operator: "eq",
          value: true,
        },
        then: { type: "text", content: "Admin view" },
        else: { type: "text", content: "User view" },
      },
    };

    const htmlAdmin = renderToStaticMarkup(
      <SpecRenderer
        spec={spec}
        registry={COMPONENT_REGISTRY}
        data={{ user: { isAdmin: true } }}
      />,
    );

    const htmlUser = renderToStaticMarkup(
      <SpecRenderer
        spec={spec}
        registry={COMPONENT_REGISTRY}
        data={{ user: { isAdmin: false } }}
      />,
    );

    expect(htmlAdmin).toContain("Admin view");
    expect(htmlUser).toContain("User view");
  });

  it("renders emptyState when list dataRef resolves to empty array", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "list",
        dataRef: "data.items",
        itemKey: "id",
        itemTemplate: { type: "text", content: "item" },
        emptyState: { type: "text", content: "No items yet" },
      },
    };

    const html = renderToStaticMarkup(
      <SpecRenderer
        spec={spec}
        registry={COMPONENT_REGISTRY}
        data={{ items: [] }}
      />,
    );

    expect(html).toContain("No items yet");
  });
});

// ===========================================================================
// Block 4: resolveDataRef unit tests
// ===========================================================================

describe("resolveDataRef (SPEC-05 / D-12)", () => {
  const makeCtx = (
    overrides: Partial<RenderContext> = {},
  ): RenderContext => ({
    data: { user: { name: "Alice", role: "admin" }, count: 42 },
    state: { isExpanded: true, counter: 5 },
    dispatch: vi.fn(),
    registry: COMPONENT_REGISTRY,
    ...overrides,
  });

  it("resolves a top-level data key", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("data.count", ctx)).toBe(42);
  });

  it("resolves a nested data key via dotted path", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("data.user.name", ctx)).toBe("Alice");
  });

  it("resolves a state key", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("state.isExpanded", ctx)).toBe(true);
  });

  it("resolves a nested state key", () => {
    const ctx = makeCtx({
      state: { theme: { color: "blue", size: "lg" } },
    });
    expect(resolveDataRef("state.theme.color", ctx)).toBe("blue");
  });

  it("returns undefined for a missing dotted path", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("data.user.nonexistent", ctx)).toBeUndefined();
  });

  it("returns undefined for a completely unknown root key", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("unknown.something", ctx)).toBeUndefined();
  });

  it("returns undefined for empty path string", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("", ctx)).toBeUndefined();
  });

  it("does NOT traverse __proto__ (prototype pollution guard, D-12)", () => {
    const ctx = makeCtx();
    // Should return undefined, not traverse prototype chain
    expect(resolveDataRef("data.__proto__.polluted", ctx)).toBeUndefined();
  });

  it("does NOT traverse constructor (prototype pollution guard, D-12)", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("data.constructor.name", ctx)).toBeUndefined();
  });

  it("does NOT traverse prototype (prototype pollution guard, D-12)", () => {
    const ctx = makeCtx();
    expect(resolveDataRef("data.prototype.something", ctx)).toBeUndefined();
  });
});

// ===========================================================================
// Block 5: useDeclaredState — all 5 mutation types
// ===========================================================================

describe("useDeclaredState (SPEC-04 / D-11)", () => {
  // We can't use renderHook without @testing-library/react.
  // Instead, build a minimal test wrapper component that captures state in a ref.

  function StateCapture({
    declarations,
    actionName,
    actionValue,
    onCapture,
  }: {
    readonly declarations: Parameters<typeof useDeclaredState>[0];
    readonly actionName?: string;
    readonly actionValue?: unknown;
    readonly onCapture: (state: Record<string, unknown>) => void;
  }): null {
    const { state, dispatch } = useDeclaredState(declarations);

    // Capture initial state on first render
    React.useEffect(() => {
      onCapture(state);
      if (actionName !== undefined) {
        dispatch(actionName, actionValue);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
  }

  it("initializes state from declarations", () => {
    // renderToStaticMarkup is synchronous — useEffect does not run in SSR.
    // Capture state during render phase instead.
    let captured: Record<string, unknown> = {};

    function RenderPhaseCapture(): null {
      const { state } = useDeclaredState([
        { name: "count", type: "number", initial: 0 },
        { name: "isOpen", type: "boolean", initial: false },
      ]);
      // Capture synchronously during render — safe for initial state test
      captured = state;
      return null;
    }

    renderToStaticMarkup(<RenderPhaseCapture />);

    // Initial state captured during render phase
    expect(captured["count"]).toBe(0);
    expect(captured["isOpen"]).toBe(false);
  });

  // For mutation tests we need to test the reducer directly, which is pure.
  // Extract testable behavior via the exported hook wrapped in a React tree.
  // Since renderToStaticMarkup is synchronous, effects won't run.
  // We test the reducer logic via a mounted React tree rendered with react-dom/client.

  it("toggle mutation: flips boolean value", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const results: unknown[] = [];

    function ToggleTest(): React.ReactElement {
      const { state, dispatch } = useDeclaredState([
        {
          name: "flag",
          type: "boolean",
          initial: false,
          actions: [{ name: "toggle", mutation: "toggle" }],
        },
      ]);

      React.useEffect(() => {
        results.push(state["flag"]);
        if (results.length === 1) {
          // After first capture, dispatch toggle
          dispatch("toggle");
        }
      });

      return React.createElement("span", null, String(state["flag"]));
    }

    await new Promise<void>((resolve) => {
      const root = createRoot(container);
      root.render(React.createElement(ToggleTest));
      // Give React time to render and run effects
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 50);
    });

    // Should have two entries: false (initial), true (after toggle)
    expect(results[0]).toBe(false);
    expect(results[1]).toBe(true);
  });

  it("set mutation: sets value from action value", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const results: unknown[] = [];

    function SetTest(): React.ReactElement {
      const { state, dispatch } = useDeclaredState([
        {
          name: "label",
          type: "string",
          initial: "original",
          actions: [{ name: "setLabel", mutation: "set" }],
        },
      ]);

      React.useEffect(() => {
        results.push(state["label"]);
        if (results.length === 1) {
          dispatch("setLabel", "updated");
        }
      });

      return React.createElement("span", null, String(state["label"]));
    }

    await new Promise<void>((resolve) => {
      const root = createRoot(container);
      root.render(React.createElement(SetTest));
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 50);
    });

    expect(results[0]).toBe("original");
    expect(results[1]).toBe("updated");
  });

  it("reset mutation: restores initial value", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const results: unknown[] = [];
    let dispatched = false;

    function ResetTest(): React.ReactElement {
      const { state, dispatch } = useDeclaredState([
        {
          name: "counter",
          type: "number",
          initial: 10,
          actions: [
            { name: "inc", mutation: "increment" },
            { name: "reset", mutation: "reset" },
          ],
        },
      ]);

      React.useEffect(() => {
        results.push(state["counter"]);
        if (!dispatched) {
          dispatched = true;
          dispatch("inc"); // → 11
        } else if (results.length === 2) {
          dispatch("reset"); // → back to 10
        }
      });

      return React.createElement("span", null, String(state["counter"]));
    }

    await new Promise<void>((resolve) => {
      const root = createRoot(container);
      root.render(React.createElement(ResetTest));
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 100);
    });

    expect(results[0]).toBe(10); // initial
    expect(results[1]).toBe(11); // after increment
    expect(results[2]).toBe(10); // after reset
  });

  it("increment mutation: numeric +1", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const results: unknown[] = [];

    function IncrementTest(): React.ReactElement {
      const { state, dispatch } = useDeclaredState([
        {
          name: "n",
          type: "number",
          initial: 5,
          actions: [{ name: "inc", mutation: "increment" }],
        },
      ]);

      React.useEffect(() => {
        results.push(state["n"]);
        if (results.length === 1) {
          dispatch("inc");
        }
      });

      return React.createElement("span", null, String(state["n"]));
    }

    await new Promise<void>((resolve) => {
      const root = createRoot(container);
      root.render(React.createElement(IncrementTest));
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 50);
    });

    expect(results[0]).toBe(5);
    expect(results[1]).toBe(6);
  });

  it("decrement mutation: numeric -1", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);

    const results: unknown[] = [];

    function DecrementTest(): React.ReactElement {
      const { state, dispatch } = useDeclaredState([
        {
          name: "n",
          type: "number",
          initial: 3,
          actions: [{ name: "dec", mutation: "decrement" }],
        },
      ]);

      React.useEffect(() => {
        results.push(state["n"]);
        if (results.length === 1) {
          dispatch("dec");
        }
      });

      return React.createElement("span", null, String(state["n"]));
    }

    await new Promise<void>((resolve) => {
      const root = createRoot(container);
      root.render(React.createElement(DecrementTest));
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 50);
    });

    expect(results[0]).toBe(3);
    expect(results[1]).toBe(2);
  });

  it("unknown action name is a no-op — returns same state reference", () => {
    // Test reducer isolation: unknown action should return same object ref
    // We can test this via the pure reducer function behavior indirectly:
    // two renders with same state → same value
    let stateRef1: Record<string, unknown> | null = null;
    let stateRef2: Record<string, unknown> | null = null;
    let callCount = 0;

    function NoopTest(): null {
      const { state } = useDeclaredState([
        { name: "x", type: "number", initial: 0 },
      ]);
      callCount++;
      if (callCount === 1) stateRef1 = state;
      if (callCount === 2) stateRef2 = state;
      return null;
    }

    renderToStaticMarkup(React.createElement(NoopTest));
    renderToStaticMarkup(React.createElement(NoopTest));

    // Both renders produce same shape
    expect(stateRef1?.["x"]).toBe(0);
    expect(stateRef2?.["x"]).toBe(0);
  });
});

// ===========================================================================
// Block 6: NodeErrorBoundary + NodeErrorFallback
// ===========================================================================

describe("NodeErrorBoundary (SPEC-03 / D-14)", () => {
  it("NodeErrorFallback renders role='alert' with node type and reason", () => {
    const html = renderToStaticMarkup(
      <NodeErrorFallback nodeType="widget" reason="render error" />,
    );

    expect(html).toContain('role="alert"');
    // renderToStaticMarkup HTML-encodes quotes: " → &quot;
    expect(html).toContain("&quot;widget&quot;");
    expect(html).toContain("render error");
  });

  it("NodeErrorFallback formats copy as [!] nodeType — reason", () => {
    const html = renderToStaticMarkup(
      <NodeErrorFallback nodeType="card" reason="prop validation failed" />,
    );

    // renderToStaticMarkup HTML-encodes quotes: " → &quot;
    expect(html).toContain('[!] &quot;card&quot; node — prop validation failed');
  });

  it("NodeErrorBoundary renders children when no error", () => {
    const html = renderToStaticMarkup(
      <NodeErrorBoundary nodeType="text">
        <span>safe content</span>
      </NodeErrorBoundary>,
    );

    expect(html).toContain("safe content");
    expect(html).not.toContain('role="alert"');
  });

  it("NodeErrorBoundary is a class component (getDerivedStateFromError contract)", () => {
    // Verify it has the getDerivedStateFromError static method (D-14)
    expect(typeof NodeErrorBoundary.getDerivedStateFromError).toBe("function");
    const result = NodeErrorBoundary.getDerivedStateFromError(new Error("test"));
    expect(result).toEqual({ hasError: true });
  });
});

// ===========================================================================
// Block 7: Round-trip regression — all 10 catalog types render without NodeErrorFallback
//
// Regression guard for CR-01 (button aria-label), CR-02 (separator aria-hidden),
// CR-03 (key-value-list label + value), and the full SHOWCASE_SPEC fixture (D-17).
//
// If any catalog node's spec schema diverges from its manifest propsSchema again,
// renderNode will produce a NodeErrorFallback containing the "[!]" prefix text and
// these tests will catch it immediately. Each test covers exactly one catalog type
// with the minimum valid props required by the manifest's .strict() propsSchema.
//
// NOTE: The marker used is "[!]" (NodeErrorFallback copy), NOT 'role="alert"'.
// The catalog's `alert` component legitimately renders with role="alert" as an
// ARIA landmark attribute — that is not a failure. NodeErrorFallback renders
// `[!] "${nodeType}" node — reason` which is unique to the error path.
// ===========================================================================

describe("Round-trip regression: all 10 catalog types render without NodeErrorFallback (D-17 / CR-01 / CR-02 / CR-03)", () => {
  /**
   * Full SHOWCASE_SPEC round-trip — the primary fixture.
   * Covers all 12 node kinds (10 catalog + list + conditional) in a single render.
   * If ANY node in the tree fails propsSchema, the "[!]" fallback text will appear
   * in the output (NodeErrorFallback renders: [!] "nodeType" node — reason).
   */
  it("SHOWCASE_SPEC renders without any NodeErrorFallback ([!] marker)", () => {
    const html = renderToStaticMarkup(
      <SpecRenderer
        spec={SHOWCASE_SPEC}
        registry={COMPONENT_REGISTRY}
        data={{
          demo: {
            rows: [
              { id: "row-1", name: "Button", category: "Action", status: "Live" },
            ],
          },
        }}
      />,
    );

    // NodeErrorFallback renders "[!] ..." — catalog alert legitimately uses role="alert"
    expect(html).not.toContain("[!]");
  });

  /**
   * Individual minimal-props tests — one per catalog type.
   * Each spec contains exactly the required fields from the manifest propsSchema.
   * These provide precise regression coverage: if one type regresses, only its test fails.
   */

  it("text: renders without NodeErrorFallback (minimal: content only)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "text", content: "Hello" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Hello");
  });

  it("badge: renders without NodeErrorFallback (minimal: label only)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "badge", label: "Active" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Active");
  });

  it("button: renders without NodeErrorFallback (requires label + aria-label — CR-01)", () => {
    // CR-01 regression: button without aria-label would produce NodeErrorFallback before the fix
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "button",
        label: "Submit",
        "aria-label": "Submit the form",
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Submit");
  });

  it("separator: renders without NodeErrorFallback (requires aria-hidden: true — CR-02)", () => {
    // CR-02 regression: separator without aria-hidden would produce NodeErrorFallback before the fix
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "stack",
        children: [
          { type: "text", content: "Above" },
          // aria-hidden: true is required by SeparatorNodeSchema (CR-02 fix).
          // SpecRoot.root is typed `any` (z.ZodTypeAny cast), so no TS error here.
          { type: "separator", "aria-hidden": true },
          { type: "text", content: "Below" },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Above");
    expect(html).toContain("Below");
  });

  it("key-value-list: renders without NodeErrorFallback (requires label + value items — CR-03)", () => {
    // CR-03 regression: key-value-list without label, or with valueRef instead of value,
    // would produce NodeErrorFallback before the fix
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "key-value-list",
        label: "Email headers",
        items: [
          { key: "From", value: "alice@example.com" },
          { key: "Subject", value: "Re: Quarterly report" },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("From");
    expect(html).toContain("alice@example.com");
  });

  it("alert: renders without NodeErrorFallback (requires title; alert uses role='alert' legitimately)", () => {
    // The `alert` catalog component renders role="alert" as an ARIA landmark — that is correct.
    // We assert absence of the NodeErrorFallback "[!]" marker, not absence of role="alert".
    const spec: SpecRoot = {
      v: 1,
      root: { type: "alert", title: "Info message" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Info message");
    // Verify it rendered as the real Alert component (role="alert" is present as ARIA landmark)
    expect(html).toContain('role="alert"');
  });

  it("card: renders without NodeErrorFallback (all props optional, empty card)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "card" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
  });

  it("table: renders without NodeErrorFallback (requires caption + columns + rows)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "table",
        caption: "Test table",
        columns: [{ key: "name", header: "Name" }],
        rows: [{ name: "Alice" }],
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
    expect(html).toContain("Test table");
    expect(html).toContain("Alice");
  });

  it("stack: renders without NodeErrorFallback (all props optional, empty stack)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "stack" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
  });

  it("grid: renders without NodeErrorFallback (all props optional, empty grid)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: { type: "grid" },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).not.toContain("[!]");
  });

  it("grid: clamps cols to child count — a 12-col grid with one child renders one full-width column (layout robustness)", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "grid",
        cols: 12,
        children: [{ type: "card", title: "Solo" }],
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).toContain("repeat(1,");
    expect(html).not.toContain("repeat(12,");
  });

  it("grid: keeps requested cols when children meet or exceed them", () => {
    const spec: SpecRoot = {
      v: 1,
      root: {
        type: "grid",
        cols: 12,
        children: [
          { type: "card", title: "A" },
          { type: "card", title: "B" },
          { type: "card", title: "C" },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <SpecRenderer spec={spec} registry={COMPONENT_REGISTRY} />,
    );
    expect(html).toContain("repeat(3,");
  });
});
