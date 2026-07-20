/**
 * research-trace.test.tsx — the deep-research transcript rows (Phase 69,
 * RSRCH-02 + RSRCH-04): collapse-to-one-line/one-click-re-expand, pmark
 * tier-1 marks (and the never-promote rule for unresolvable citations),
 * http(s)-only external source links, error/degraded/aborted/empty states,
 * and the dispatch seam from ToolInvocationResultRow.
 *
 * Mounts the REAL components — mirrors this repo's createRoot-in-jsdom +
 * `act` convention (tool-invocation-result-row.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseResearchRun,
  researchSummaryLabel,
  ResearchActivityRow,
  ResearchTraceRow,
  safeExternalHref,
  sourceMarkLabel,
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

const ENVELOPE = JSON.stringify({
  mode: "deep_research",
  report: "The synthesized body.",
  aborted: false,
  sources: [
    {
      id: "s1",
      url: "https://www.example.com/page",
      title: "Example page",
      excerpt: "Verbatim source words.",
    },
    {
      id: "s2",
      url: "javascript:alert(1)",
      title: "Hostile source",
      excerpt: "More words.",
    },
  ],
  claims: [
    { text: "Claim one holds.", source_ids: ["s1"] },
    { text: "Claim two dangles.", source_ids: ["missing"] },
  ],
});

describe("ResearchTraceRow", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  // Test 1 — RSRCH-04: one line when done, nothing else.
  it("mounts COLLAPSED: the one-line summary with real counts, aria-expanded=false, no claim text in the DOM", async () => {
    const container = await mount(<ResearchTraceRow content={ENVELOPE} isError={false} />);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain(
      "Deep research — 2 verified claims · 2 sources",
    );
    expect(container.textContent).not.toContain("Claim one holds.");
    expect(container.textContent).not.toContain("Sources");
  });

  // Test 2 — RSRCH-04: one click to re-expand, one click back to one line.
  it("one click expands the full trace (steps, claims, sources); a second click collapses it again", async () => {
    const container = await mount(<ResearchTraceRow content={ENVELOPE} isError={false} />);
    const button = container.querySelector("button");
    await click(button as Element);
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Planned the research");
    expect(container.textContent).toContain("Ran web-search rounds — 2 sources cited");
    expect(container.textContent).toContain("Adversarial check against sources — 2 claims kept");
    expect(container.textContent).toContain("Synthesized the report");
    expect(container.textContent).toContain("Claim one holds.");
    expect(container.textContent).toContain("Verbatim source words.");
    await click(button as Element);
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Claim one holds.");
  });

  // Test 3 — RSRCH-02 tier 1: the resolving claim wears the signature mark;
  // the dangling one is NEVER promoted to it.
  it("a claim with a resolving citation wears pmark pmark-suggested; a claim whose citations do not resolve renders unmarked", async () => {
    const container = await mount(<ResearchTraceRow content={ENVELOPE} isError={false} />);
    await click(container.querySelector("button") as Element);
    const marked = Array.from(container.querySelectorAll(".pmark.pmark-suggested"));
    const markedTexts = marked.map((el) => el.textContent);
    expect(markedTexts).toContain("Claim one holds.");
    expect(markedTexts).not.toContain("Claim two dangles.");
    // The dangling claim still renders — demoted to plain text, not dropped.
    expect(container.textContent).toContain("Claim two dangles.");
  });

  // Test 4 — untrusted url discipline: http(s) links out, anything else is
  // plain text (fail-closed), never an href.
  it("renders an external <a> only for http(s) source urls — the javascript: url renders as text with no anchor", async () => {
    const container = await mount(<ResearchTraceRow content={ENVELOPE} isError={false} />);
    await click(container.querySelector("button") as Element);
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://www.example.com/page");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(anchors[0]?.getAttribute("rel")).toContain("noopener");
    // The hostile source still appears (as text), it just links nowhere.
    expect(container.textContent).toContain("Hostile source");
  });

  // Test 5 — the aborted run states itself honestly.
  it("an aborted run says 'stopped early' in the summary and shows the ink stopped-early step when expanded", async () => {
    const aborted = JSON.stringify({
      mode: "deep_research",
      report: "",
      aborted: true,
      sources: [],
      claims: [],
    });
    const container = await mount(<ResearchTraceRow content={aborted} isError={false} />);
    expect(container.textContent).toContain("Deep research — no verified claims · stopped early");
    await click(container.querySelector("button") as Element);
    expect(container.textContent).toContain("Stopped early — research budget reached");
    // Empty state teaches the next action rather than presenting a bare zero.
    expect(container.textContent).toContain("No claim survived verification");
  });

  // Test 6 — error row: ink alert, never the trace.
  it("isError renders the role=alert ink row and no disclosure button", async () => {
    const container = await mount(<ResearchTraceRow content="ignored" isError={true} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Couldn't complete the deep research.");
    expect(container.querySelector("button")).toBeNull();
  });

  // Test 7 — the cap_tool_output truncation edge: degrade, never throw,
  // never render the raw string.
  it("unparseable content degrades to the details-unavailable row without rendering the raw string", async () => {
    const truncated = ENVELOPE.slice(0, 40);
    const container = await mount(<ResearchTraceRow content={truncated} isError={false} />);
    expect(container.textContent).toContain("Ran deep research — details unavailable.");
    expect(container.textContent).not.toContain("deep_research");
  });
});

describe("dispatch seams", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  // Test 8 — ToolInvocationResultRow hands deep_research to the trace row.
  it("ToolInvocationResultRow renders the research trace for toolName=deep_research, not the generic results line", async () => {
    const container = await mount(
      <ToolInvocationResultRow toolName="deep_research" content={ENVELOPE} isError={false} />,
    );
    expect(container.textContent).toContain("Deep research — 2 verified claims · 2 sources");
    expect(container.textContent).not.toContain("Ran a lookup");
  });

  // Test 9 — the in-flight row is an honest multi-minute status, not a
  // gerund one-liner.
  it("ResearchActivityRow is a role=status row that sets the minutes-scale expectation", async () => {
    const container = await mount(<ResearchActivityRow />);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("Researching — planning, searching, verifying…");
    expect(container.textContent).toContain("this can take a few minutes");
  });
});

describe("pure helpers", () => {
  // Test 10
  it("parseResearchRun coerces defensively: drops idless sources and textless claims, keeps order", () => {
    const run = parseResearchRun(
      JSON.stringify({
        report: 7, // wrong type -> ""
        aborted: "yes", // not `true` -> false
        sources: [{ id: "s1", url: 1, title: null }, { url: "https://x.test" }, "junk"],
        claims: [{ text: "  " }, { text: "Real", source_ids: ["s1", 3, "  "] }, null],
      }),
    );
    expect(run).not.toBeNull();
    expect(run?.report).toBe("");
    expect(run?.aborted).toBe(false);
    expect(run?.sources).toEqual([{ id: "s1", url: "", title: "", excerpt: "" }]);
    expect(run?.claims).toEqual([{ text: "Real", sourceIds: ["s1"] }]);
  });

  // Test 11
  it("safeExternalHref allows only http(s); sourceMarkLabel prefers hostname, then title, then id", () => {
    expect(safeExternalHref("https://a.test/x")).toBe("https://a.test/x");
    expect(safeExternalHref("HTTP://a.test")).toBe("HTTP://a.test");
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("")).toBeUndefined();
    expect(
      sourceMarkLabel({ id: "s1", url: "https://www.host.test/p", title: "T", excerpt: "" }),
    ).toBe("host.test");
    expect(sourceMarkLabel({ id: "s1", url: "", title: "A title", excerpt: "" })).toBe("A title");
    expect(sourceMarkLabel({ id: "s9", url: "", title: "  ", excerpt: "" })).toBe("s9");
  });

  // Test 12
  it("researchSummaryLabel: singular counts and the no-claims variant", () => {
    expect(
      researchSummaryLabel({
        report: "",
        aborted: false,
        sources: [{ id: "s1", url: "", title: "", excerpt: "" }],
        claims: [{ text: "c", sourceIds: [] }],
      }),
    ).toBe("Deep research — 1 verified claim · 1 source");
    expect(
      researchSummaryLabel({ report: "", aborted: false, sources: [], claims: [] }),
    ).toBe("Deep research — no verified claims");
  });
});
