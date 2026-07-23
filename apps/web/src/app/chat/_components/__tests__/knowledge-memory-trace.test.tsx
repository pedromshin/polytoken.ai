/**
 * knowledge-memory-trace.test.tsx — AI-06's canon knowledge-graph memory
 * recall rendered through the REUSED research-trace component (variant
 * "knowledge_memory"): the dispatch seam from ToolInvocationResultRow, the
 * memory summary label, and — the load-bearing requirement — citations that
 * resolve to REAL /knowledge node ids as internal deep-links (never external,
 * never a hostile scheme).
 *
 * Mounts the REAL components — same createRoot-in-jsdom + `act` convention as
 * research-trace.test.tsx.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  KNOWLEDGE_MEMORY_TOOL_NAME,
  ResearchTraceRow,
  memorySummaryLabel,
  parseResearchRun,
  safeInternalHref,
} from "../research-trace";
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

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

// The Python listener's build_memory_citation_envelope output shape — two
// canon nodes cited by /knowledge deep-links, plus one hostile url that must
// NEVER become a link.
const MEMORY_ENVELOPE = JSON.stringify({
  mode: "knowledge_memory",
  report: "",
  aborted: false,
  sources: [
    {
      id: "node-aaa",
      url: "/knowledge?node=node-aaa",
      title: "Acme Corp ships via SeaFreight",
      excerpt: "Established relationship.",
    },
    {
      id: "node-hostile",
      url: "https://evil.example.com/x",
      title: "External source (must not link)",
      excerpt: "words",
    },
  ],
  claims: [
    { text: "Acme Corp — ships_via → entity_instance:tgt", source_ids: ["node-aaa"] },
  ],
});

describe("knowledge-memory trace (AI-06)", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("safeInternalHref allows only /knowledge paths, fail-closed", () => {
    expect(safeInternalHref("/knowledge?node=x")).toBe("/knowledge?node=x");
    expect(safeInternalHref("/knowledge/123")).toBe("/knowledge/123");
    expect(safeInternalHref("/knowledge")).toBe("/knowledge");
    expect(safeInternalHref("https://evil.example.com/x")).toBeUndefined();
    expect(safeInternalHref("//evil.example.com")).toBeUndefined();
    expect(safeInternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeInternalHref("/knowledgebase")).toBeUndefined();
  });

  it("memorySummaryLabel counts recalled facts and sources", () => {
    const run = parseResearchRun(MEMORY_ENVELOPE);
    expect(run).not.toBeNull();
    expect(memorySummaryLabel(run!)).toBe("Agent memory — 1 fact recalled · 2 sources");
  });

  it("ToolInvocationResultRow dispatches the knowledge_memory tool to the memory trace", async () => {
    const container = await mount(
      <ToolInvocationResultRow
        toolName={KNOWLEDGE_MEMORY_TOOL_NAME}
        content={MEMORY_ENVELOPE}
        isError={false}
      />,
    );
    // Memory summary, NOT the deep-research label.
    expect(container.textContent).toContain("Agent memory — 1 fact recalled · 2 sources");
    expect(container.textContent).not.toContain("Deep research");
  });

  it("expanded: citation links resolve to the REAL /knowledge node id; a non-/knowledge url is never a link", async () => {
    const container = await mount(
      <ResearchTraceRow content={MEMORY_ENVELOPE} isError={false} variant="knowledge_memory" />,
    );
    await click(container.querySelector("button") as Element);

    // The canon node is a real internal deep-link carrying its node id.
    const anchors = Array.from(container.querySelectorAll("a"));
    const internal = anchors.find((a) => a.getAttribute("href") === "/knowledge?node=node-aaa");
    expect(internal).toBeDefined();

    // Memory provenance line + label, and the recalled fact text.
    expect(container.textContent).toContain("Recalled from your knowledge graph");
    expect(container.textContent).toContain("Cited knowledge nodes");
    expect(container.textContent).toContain("Acme Corp — ships_via → entity_instance:tgt");

    // The external/hostile source is rendered but NEVER as an href (internal
    // resolver is fail-closed — memory citations are /knowledge only).
    expect(anchors.some((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toBe(false);
  });

  it("error state speaks in memory terms", async () => {
    const container = await mount(
      <ResearchTraceRow content="" isError variant="knowledge_memory" />,
    );
    expect(container.textContent).toContain("Couldn't recall from your knowledge graph.");
  });
});
