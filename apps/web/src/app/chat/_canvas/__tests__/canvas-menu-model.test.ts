/**
 * canvas-menu-model.test.ts — context-menu item GENERATION (CI-01): the pane
 * "Add node" submenu is generated from NODE_TYPE_REGISTRY (never hand-listed),
 * humanization, the addable flag, and the verb descriptors.
 */

import { describe, expect, it } from "vitest";

import { NODE_TYPE_REGISTRY } from "../node-type-registry";
import {
  addNodeMenuItems,
  EDGE_VERBS,
  GENERIC_NODE_VERBS,
  humanizeNodeType,
} from "../canvas-menu-model";

describe("humanizeNodeType", () => {
  it("title-cases and de-hyphenates a node type id", () => {
    expect(humanizeNodeType("genui-panel")).toBe("Genui panel");
    expect(humanizeNodeType("email-thread")).toBe("Email thread");
    expect(humanizeNodeType("chat")).toBe("Chat");
  });
});

describe("addNodeMenuItems", () => {
  it("generates exactly one item per NODE_TYPE_REGISTRY id (not hand-listed)", () => {
    const items = addNodeMenuItems(new Set());
    const generatedTypes = items.map((i) => i.nodeType).sort();
    const registryTypes = Object.keys(NODE_TYPE_REGISTRY).sort();
    expect(generatedTypes).toEqual(registryTypes);
  });

  it("is sorted for a stable menu order", () => {
    const items = addNodeMenuItems(new Set());
    const types = items.map((i) => i.nodeType);
    expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
  });

  it("flags only the supported types as addable", () => {
    const supported = new Set(["email-thread", "knowledge-preview"]);
    const items = addNodeMenuItems(supported);
    for (const item of items) {
      expect(item.addable).toBe(supported.has(item.nodeType));
    }
    expect(items.filter((i) => i.addable)).toHaveLength(2);
  });

  it("carries a humanized label per item", () => {
    const items = addNodeMenuItems(new Set());
    const emailThread = items.find((i) => i.nodeType === "email-thread");
    expect(emailThread?.label).toBe("Email thread");
  });
});

describe("verb descriptors", () => {
  it("generic node verbs are the reversible set (no confirm)", () => {
    expect(GENERIC_NODE_VERBS.map((v) => v.id)).toEqual([
      "duplicate",
      "connect",
      "sendToChat",
      "remove",
    ]);
    expect(GENERIC_NODE_VERBS.every((v) => v.confirm === undefined)).toBe(true);
  });

  it("edge verbs are edit-label / reverse / delete in order", () => {
    expect(EDGE_VERBS.map((v) => v.id)).toEqual(["editLabel", "reverse", "delete"]);
  });
});
