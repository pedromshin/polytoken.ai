/**
 * build-tool-flow.test.ts — the pure summon-loop core (Phase 76 / 76-04).
 *
 * Covers the manifest/binding split (shape → generator, wiring → persistence),
 * targetKey uniqueness + sanitization, publish-gated eligibility, and the ≥2
 * floor the caller enforces on `sources`.
 */

import { describe, expect, it } from "vitest";
import type { Node as FlowNode } from "@xyflow/react";

import {
  buildToolIntent,
  collectToolInputs,
  describeSourceShape,
  toTargetKey,
} from "../build-tool-flow";
import { publishedNodePath } from "../canvas-publish";

function node(id: string, type: string, selected = true): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: {}, selected } as FlowNode;
}

/** Build a store `values` blob with the given nodes' projections published. */
function valuesWith(published: Record<string, unknown>): Record<string, unknown> {
  const byNode: Record<string, unknown> = {};
  for (const [nodeId, projection] of Object.entries(published)) {
    byNode[nodeId] = projection;
  }
  return { shared: { published: byNode } };
}

describe("toTargetKey", () => {
  it("sanitizes a hyphenated type to a JS-identifier-ish key", () => {
    expect(toTargetKey("review-queue", new Set())).toBe("review_queue");
  });

  it("disambiguates collisions with a numeric suffix", () => {
    const used = new Set<string>(["usage"]);
    const k = toTargetKey("usage", used);
    expect(k).toBe("usage_2");
  });

  it("prefixes a key that would not start with a letter", () => {
    const k = toTargetKey("123", new Set());
    expect(/^[A-Za-z]/.test(k)).toBe(true);
  });
});

describe("describeSourceShape", () => {
  it("carries top-level field names + coarse types, never values", () => {
    const entry = describeSourceShape("usage", {
      label: "Today's spend",
      spendTodayUsd: 3.5,
      atCap: false,
    });
    expect(entry.nodeType).toBe("usage");
    expect(entry.label).toBe("Today's spend");
    const names = (entry.fields ?? []).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["label", "spendTodayUsd", "atCap"]));
    // no data VALUE leaks into the manifest — only names + coarse types
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("3.5");
  });

  it("lifts a numeric rowCount for a table-shaped projection", () => {
    const entry = describeSourceShape("spreadsheet", {
      label: "Rent",
      columns: [{ name: "month" }],
      rowCount: 12,
      sample: [{ month: "Jan" }],
    });
    expect(entry.rowCount).toBe(12);
  });

  it("returns a bare descriptor for a non-object projection", () => {
    expect(describeSourceShape("x", 42)).toEqual({ nodeType: "x" });
  });
});

describe("collectToolInputs", () => {
  it("assembles parallel inputs + bindings for published, selected sources", () => {
    const nodes = [
      node("usage:1", "usage"),
      node("spreadsheet:2", "spreadsheet"),
    ];
    const values = valuesWith({
      "usage:1": { label: "Spend", spendTodayUsd: 3.5 },
      "spreadsheet:2": { label: "Rent", rowCount: 12 },
    });

    const result = collectToolInputs(nodes, values);

    expect(result.sources).toHaveLength(2);
    const keys = result.sources.map((s) => s.targetKey);
    expect(new Set(keys).size).toBe(2); // distinct

    // binding sourcePath points at the published projection path
    for (const s of result.sources) {
      expect(result.inputBindings[s.targetKey]?.sourcePath).toBe(
        publishedNodePath(s.nodeId),
      );
      expect(result.inputBindings[s.targetKey]?.sourceNodeKey).toBe(s.nodeId);
      expect(result.inputs[s.targetKey]?.nodeType).toBe(s.nodeType);
    }
    expect(result.intent).toContain("window.__ISLAND_DATA__");
  });

  it("skips selected nodes that have not published a projection", () => {
    const nodes = [
      node("usage:1", "usage"),
      node("spreadsheet:2", "spreadsheet"), // no projection published
    ];
    const values = valuesWith({ "usage:1": { label: "Spend" } });

    const result = collectToolInputs(nodes, values);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.nodeId).toBe("usage:1");
  });

  it("excludes the chat singleton and other code-islands", () => {
    const nodes = [
      node("chat", "chat"),
      node("code-island:1", "code-island"),
      node("usage:1", "usage"),
      node("brief:2", "brief"),
    ];
    const values = valuesWith({
      chat: { label: "chat" },
      "code-island:1": { label: "tool" },
      "usage:1": { label: "Spend" },
      "brief:2": { label: "Brief" },
    });

    const result = collectToolInputs(nodes, values);
    const types = result.sources.map((s) => s.nodeType).sort();
    expect(types).toEqual(["brief", "usage"]);
  });

  it("gives two same-type sources distinct target keys", () => {
    const nodes = [node("usage:1", "usage"), node("usage:2", "usage")];
    const values = valuesWith({
      "usage:1": { label: "A" },
      "usage:2": { label: "B" },
    });
    const result = collectToolInputs(nodes, values);
    const keys = result.sources.map((s) => s.targetKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("buildToolIntent", () => {
  it("names the sources and points the model at the data channel", () => {
    const intent = buildToolIntent(["Spend", "Rent"]);
    expect(intent).toContain("Spend");
    expect(intent).toContain("Rent");
    expect(intent).toContain("window.__ISLAND_DATA__");
  });
});
