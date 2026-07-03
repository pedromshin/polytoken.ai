/**
 * genui-part-boundary.test.tsx — unit tests for progressive partial-tree
 * genui rendering (STREAM-02, D-17, FOUND-6).
 *
 * Security contracts under test:
 *   T-22-33: an untrusted model-authored spec crosses SpecRootSchema.safeParse
 *            before ever reaching the (unmodified) SpecRenderer.
 *   T-22-34: no eval / new Function anywhere on this render path (grep-gated
 *            separately by the plan's acceptance criteria).
 *
 * Test environment: jsdom + react-dom/client (matches this codebase's
 * established convention — see markdown-renderer.test.tsx).
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Forward declaration — will fail to resolve until genui-part-boundary.tsx
// is created (RED).
import { GenuiPartBoundary } from "../genui-part-boundary";

let containers: HTMLDivElement[] = [];

function mount(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

describe("GenuiPartBoundary", () => {
  beforeEach(() => {
    containers = [];
  });

  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("renders a complete valid spec via the unmodified SpecRenderer inside a bordered Card", () => {
    const specJson = JSON.stringify({
      v: 1,
      root: { type: "text", content: "Hello widget" },
    });

    const container = mount(
      <GenuiPartBoundary specJson={specJson} isStreaming={false} />,
    );

    const card = container.querySelector(".border-border");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Hello widget");
  });

  it("renders at least one valid subtree AND at least one Skeleton placeholder for a partial JSON buffer", () => {
    // A stack with one COMPLETE text child and a second child truncated
    // mid-stream (no closing quote/brace yet) — the lenient partial parser
    // must drop the incomplete tail and render only the valid prefix.
    const partialBuffer =
      '{"v":1,"root":{"type":"stack","children":[' +
      '{"type":"text","content":"First"},' +
      '{"type":"text","content":"Sec';

    const container = mount(
      <GenuiPartBoundary specJson={partialBuffer} isStreaming={true} />,
    );

    expect(container.textContent).toContain("First");
    expect(container.textContent).not.toContain("Sec");

    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders SAFE_FALLBACK_SPEC when the completed spec fails schema validation", () => {
    // Unrecognized discriminant — well-formed JSON, but no SpecNodeSchema
    // union member matches "type": "nonexistent-widget".
    const invalidJson = JSON.stringify({
      v: 1,
      root: { type: "nonexistent-widget" },
    });

    const container = mount(
      <GenuiPartBoundary specJson={invalidJson} isStreaming={false} />,
    );

    expect(container.textContent).toContain(
      "Could not generate a view for this request",
    );
  });
});
