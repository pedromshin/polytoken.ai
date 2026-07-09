/**
 * tool-invocation-result-row.test.tsx — ToolInvocationResultRow (TUI-01
 * completion + TUI-02 citations, 39-UI-SPEC.md "Component 2") unit tests:
 * completed/zero-results/error/degraded copy variants, citation chip
 * rendering (dedupe -> cap at 5 -> overflow badge), and the "never render
 * raw content verbatim" guarantee.
 *
 * Mounts the REAL component — mirrors this repo's createRoot-in-jsdom + `act`
 * convention (compact-interaction-entry.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ToolInvocationResultRow } from "../tool-invocation-result-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ToolInvocationResultRow", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  // Test 1
  it("success with 3 results + 2 distinct citations renders the completed label with count substituted plus 2 chips", async () => {
    const content = JSON.stringify({
      results: [1, 2, 3],
      citations: [
        { kind: "entity", id: "e1", route: "/entities/e1" },
        { kind: "email", id: "m1", route: "/emails/m1" },
      ],
    });
    const container = await mount(
      <ToolInvocationResultRow toolName="lookup_entity" content={content} isError={false} />,
    );
    expect(container.textContent).toContain("Looked up an entity — 3 results");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  // Test 2
  it("singular '1 result' (not '1 results') when results.length === 1", async () => {
    const content = JSON.stringify({ results: [1], citations: [] });
    const container = await mount(
      <ToolInvocationResultRow toolName="lookup_entity" content={content} isError={false} />,
    );
    expect(container.textContent).toContain("Looked up an entity — 1 result");
    expect(container.textContent).not.toContain("1 results");
  });

  // Test 3
  it("zero results renders the zero-results label variant with NO chip container element at all", async () => {
    const content = JSON.stringify({ results: [], citations: [] });
    const container = await mount(
      <ToolInvocationResultRow toolName="lookup_entity" content={content} isError={false} />,
    );
    expect(container.textContent).toContain("Looked up an entity — no results found");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // "empty renders nothing" — no empty wrapping chip-row <div> either. The
    // row itself has exactly one child <div> (the outer flex row).
    expect(container.querySelectorAll("div").length).toBe(1);
  });

  // Test 4
  it("more than 5 distinct citations renders exactly 5 chips plus a non-link '+N' overflow span", async () => {
    const citations = Array.from({ length: 7 }, (_, i) => ({
      kind: "entity",
      id: `e${i}`,
      route: `/entities/e${i}`,
    }));
    const content = JSON.stringify({ results: [1, 2, 3, 4, 5, 6, 7], citations });
    const container = await mount(
      <ToolInvocationResultRow toolName="search_knowledge" content={content} isError={false} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(5);
    expect(container.textContent).toContain("+2");
    const overflowSpans = Array.from(container.querySelectorAll("span")).filter((s) =>
      s.textContent?.includes("+2"),
    );
    expect(overflowSpans).toHaveLength(1);
    expect(overflowSpans[0]?.tagName).toBe("SPAN");
  });

  // Test 5
  it("dedupes a duplicate {kind,id} citation pair BEFORE slicing/capping", async () => {
    const content = JSON.stringify({
      results: [1, 2, 3],
      citations: [
        { kind: "entity", id: "e1", route: "/entities/e1" },
        { kind: "entity", id: "e2", route: "/entities/e2" },
        { kind: "entity", id: "e3", route: "/entities/e3" },
        { kind: "entity", id: "e1", route: "/entities/e1" }, // duplicate of the first
      ],
    });
    const container = await mount(
      <ToolInvocationResultRow toolName="lookup_entity" content={content} isError={false} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(3);
  });

  // Test 6
  it("isError renders the fixed per-tool error label, never the raw content verbatim, role=alert, zero chips, zero retry button", async () => {
    const markerToken = "UNIQUE_RAW_ERROR_MARKER_XYZ";
    const container = await mount(
      <ToolInvocationResultRow
        toolName="lookup_entity"
        content={`Tool execution failed: ${markerToken}`}
        isError={true}
      />,
    );
    expect(container.textContent).toContain("Couldn't look up that entity.");
    expect(container.textContent).not.toContain(markerToken);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  // Test 7
  it("malformed (unparseable) content with isError=false renders the degraded 'details unavailable' variant without throwing", async () => {
    const malformedContent = '{"results": [1, 2, "trunc';
    let container: HTMLDivElement | undefined;
    await expect(
      (async () => {
        container = await mount(
          <ToolInvocationResultRow toolName="search_emails" content={malformedContent} isError={false} />,
        );
      })(),
    ).resolves.not.toThrow();
    expect(container?.textContent).toContain("Searched emails — details unavailable.");
    expect(container?.querySelectorAll("a")).toHaveLength(0);
  });

  // Test 8
  it("an unrecognized toolName falls back to the generic 'Ran a lookup' / 'Couldn't complete that lookup.' copy", async () => {
    const content = JSON.stringify({ results: [1, 2], citations: [] });
    const successContainer = await mount(
      <ToolInvocationResultRow toolName="some_unknown_tool" content={content} isError={false} />,
    );
    expect(successContainer.textContent).toContain("Ran a lookup — 2 results");

    const errorContainer = await mount(
      <ToolInvocationResultRow toolName="some_unknown_tool" content="whatever" isError={true} />,
    );
    expect(errorContainer.textContent).toContain("Couldn't complete that lookup.");
  });
});
