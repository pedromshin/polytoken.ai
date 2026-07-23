/**
 * knowledge-search-panel.test.tsx — behavioral tests for the KG-8 web
 * reachability half: the /knowledge search panel.
 *
 * The panel is presentational (query/results/handlers injected by
 * knowledge-graph.tsx — the FilterRail convention), so it mounts in jsdom
 * without the ReactFlow canvas host. Also pins shouldRunKnowledgeSearch,
 * the shared server-hit gating rule.
 *
 * Mounts the REAL component — createRoot-in-jsdom + `act` convention.
 * jsdom proves behavior only, nothing visual.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KnowledgeSearchPanel,
  shouldRunKnowledgeSearch,
  type KnowledgeSearchResultItem,
} from "../knowledge-search-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  roots = [];
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

const RESULTS: ReadonlyArray<KnowledgeSearchResultItem> = [
  { id: "node-1", title: "Invoice INV-123", tier: "EXTRACTED" },
  { id: "node-2", title: null, tier: "EXTRACTED" },
];

function panel(
  overrides: Partial<React.ComponentProps<typeof KnowledgeSearchPanel>> = {},
): React.ReactElement {
  return (
    <KnowledgeSearchPanel
      query=""
      onQueryChange={() => undefined}
      results={undefined}
      isLoading={false}
      isError={false}
      onSelectResult={() => undefined}
      {...overrides}
    />
  );
}

describe("shouldRunKnowledgeSearch", () => {
  it("requires 2+ chars after trimming", () => {
    expect(shouldRunKnowledgeSearch("")).toBe(false);
    expect(shouldRunKnowledgeSearch(" a ")).toBe(false);
    expect(shouldRunKnowledgeSearch("ab")).toBe(true);
    expect(shouldRunKnowledgeSearch("  po  ")).toBe(true);
  });
});

describe("KnowledgeSearchPanel", () => {
  it("typing propagates through onQueryChange (controlled input)", async () => {
    const onQueryChange = vi.fn();
    const container = await mount(panel({ onQueryChange }));

    const input = container.querySelector<HTMLInputElement>(
      "#knowledge-search-input",
    );
    expect(input).not.toBeNull();

    await act(async () => {
      // React 19 controlled-input: set value via the native setter, then
      // dispatch input so React's onChange fires.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "invoice");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalledWith("invoice");
  });

  it("teaches the min-length rule instead of silently doing nothing", async () => {
    const container = await mount(panel({ query: "a" }));
    expect(container.textContent).toContain("at least 2 characters");
  });

  it("renders result titles in the evidence register and selects on click", async () => {
    const onSelectResult = vi.fn();
    const container = await mount(
      panel({ query: "invoice", results: RESULTS, onSelectResult }),
    );

    const items = container.querySelectorAll('ul[aria-label="Search results"] button');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Invoice INV-123");
    // Law 2: titles are the user's material — serif + data-evidence.
    expect(items[0]!.querySelector("[data-evidence]")).not.toBeNull();
    // A null title never renders blank.
    expect(items[1]!.textContent).toContain("(untitled)");

    await act(async () => {
      (items[0] as HTMLButtonElement).click();
    });
    expect(onSelectResult).toHaveBeenCalledWith("node-1");
  });

  it("shows the honest no-matches state", async () => {
    const container = await mount(panel({ query: "zz", results: [] }));
    expect(container.textContent).toContain("No confirmed knowledge matches.");
  });

  it("shows a framed error state on failure (never a silent nothing)", async () => {
    const container = await mount(
      panel({ query: "invoice", isError: true, results: undefined }),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Search failed.");
  });

  it("shows the loading indicator while a search is in flight", async () => {
    const container = await mount(
      panel({ query: "invoice", isLoading: true, results: undefined }),
    );
    expect(container.textContent).toContain("Searching…");
  });
});
