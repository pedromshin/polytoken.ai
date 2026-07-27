/**
 * message-to-document.test.ts — the pure markdown→ReportBlock converter and
 * title derivation (DOCS-01). No jsdom: this is a total text→model transform,
 * so it is asserted directly (MEMORY: jsdom does no layout — a pure transform
 * needs no DOM).
 */
import { describe, expect, it } from "vitest";

import {
  buildDocumentDraft,
  deriveDocumentTitle,
  markdownToReportBlocks,
} from "../message-to-document";

describe("markdownToReportBlocks", () => {
  it("returns [] for empty / whitespace-only text", () => {
    expect(markdownToReportBlocks("")).toEqual([]);
    expect(markdownToReportBlocks("   \n\n  ")).toEqual([]);
  });

  it("maps headings to levels 1–3 and clamps deeper headings to 3", () => {
    const blocks = markdownToReportBlocks("# A\n## B\n### C\n#### D");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "A" },
      { kind: "heading", level: 2, text: "B" },
      { kind: "heading", level: 3, text: "C" },
      { kind: "heading", level: 3, text: "D" },
    ]);
  });

  it("joins soft-wrapped lines into one paragraph and splits on blank lines", () => {
    const blocks = markdownToReportBlocks("one\ntwo\n\nthree");
    expect(blocks).toEqual([
      { kind: "paragraph", runs: ["one two"] },
      { kind: "paragraph", runs: ["three"] },
    ]);
  });

  it("collects blockquote lines into an evidence block", () => {
    const blocks = markdownToReportBlocks("> quoted a\n> quoted b");
    expect(blocks).toEqual([{ kind: "evidence", runs: ["quoted a quoted b"] }]);
  });

  it("collects unordered and ordered list items, and separates flavours", () => {
    const blocks = markdownToReportBlocks("- x\n- y\n1. a\n2. b");
    expect(blocks).toEqual([
      { kind: "list", ordered: false, items: [["x"], ["y"]] },
      { kind: "list", ordered: true, items: [["a"], ["b"]] },
    ]);
  });

  it("carries no fabricated provenance — every run is a bare string", () => {
    const blocks = markdownToReportBlocks("A confirmed figure of $10.");
    expect(blocks).toEqual([{ kind: "paragraph", runs: ["A confirmed figure of $10."] }]);
    // Not a single ProvSpan object was invented from prose the message never marked.
    for (const b of blocks) {
      if (b.kind === "paragraph" || b.kind === "evidence") {
        for (const run of b.runs) expect(typeof run).toBe("string");
      }
    }
  });
});

describe("deriveDocumentTitle", () => {
  it("prefers the first heading", () => {
    expect(deriveDocumentTitle("intro\n# The Real Title\nmore")).toBe("intro");
    expect(deriveDocumentTitle("# The Real Title\nbody")).toBe("The Real Title");
  });

  it("falls back to the first non-empty line with chrome stripped", () => {
    expect(deriveDocumentTitle("- first bullet\nrest")).toBe("first bullet");
  });

  it("uses the fallback for empty text", () => {
    expect(deriveDocumentTitle("   \n ", "Deep research report")).toBe("Deep research report");
  });

  it("clamps to 200 chars", () => {
    const long = "x".repeat(300);
    expect(deriveDocumentTitle(long).length).toBe(200);
  });
});

describe("buildDocumentDraft", () => {
  it("bundles a derived title with real blocks", () => {
    const draft = buildDocumentDraft("# Report\n\nBody text.");
    expect(draft.title).toBe("Report");
    expect(draft.blocks).toEqual([
      { kind: "heading", level: 1, text: "Report" },
      { kind: "paragraph", runs: ["Body text."] },
    ]);
  });
});
