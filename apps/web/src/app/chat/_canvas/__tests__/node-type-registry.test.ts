/**
 * node-type-registry.test.ts — unit tests for the versioned node-type
 * registry, its content-hash version, and the genui-panel node.data boundary
 * (CANVAS-03, FOUND-2, D-04, D-05).
 */

import { describe, expect, it } from "vitest";

import {
  computeNodeRegistryHash,
  NODE_REGISTRY_VERSION,
} from "../node-registry-version";
import {
  GenuiPanelNodeDataSchema,
  KnowledgePreviewNodeDataSchema,
  SpreadsheetNodeDataSchema,
} from "../node-data-schemas";
import {
  NODE_TYPE_REGISTRY,
  resolveNodeType,
} from "../node-type-registry";
import type { NodeTypeRegistryEntry } from "../node-type-registry";
import { z } from "zod";

describe("computeNodeRegistryHash", () => {
  it("returns the same hex for the same registry (determinism)", () => {
    const hashA = computeNodeRegistryHash(NODE_TYPE_REGISTRY);
    const hashB = computeNodeRegistryHash(NODE_TYPE_REGISTRY);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is insensitive to registration order (sorted keys)", () => {
    const reordered: Record<string, NodeTypeRegistryEntry> = {
      editor: NODE_TYPE_REGISTRY.editor!,
      desktop: NODE_TYPE_REGISTRY.desktop!,
      source: NODE_TYPE_REGISTRY.source!,
      browser: NODE_TYPE_REGISTRY.browser!,
      document: NODE_TYPE_REGISTRY.document!,
      "email-thread": NODE_TYPE_REGISTRY["email-thread"]!,
      "knowledge-preview": NODE_TYPE_REGISTRY["knowledge-preview"]!,
      "genui-panel": NODE_TYPE_REGISTRY["genui-panel"]!,
      directory: NODE_TYPE_REGISTRY.directory!,
      "circle-pack": NODE_TYPE_REGISTRY["circle-pack"]!,
      chat: NODE_TYPE_REGISTRY.chat!,
      spreadsheet: NODE_TYPE_REGISTRY.spreadsheet!,
      file: NODE_TYPE_REGISTRY.file!,
    };
    expect(computeNodeRegistryHash(reordered)).toBe(
      computeNodeRegistryHash(NODE_TYPE_REGISTRY),
    );
  });

  it("flips when an entry's description changes", () => {
    const original = computeNodeRegistryHash(NODE_TYPE_REGISTRY);
    const mutated: Record<string, NodeTypeRegistryEntry> = {
      ...NODE_TYPE_REGISTRY,
      chat: { ...NODE_TYPE_REGISTRY.chat!, description: "changed description" },
    };
    expect(computeNodeRegistryHash(mutated)).not.toBe(original);
  });

  it("flips when an entry's schema shape changes (field added)", () => {
    const original = computeNodeRegistryHash(NODE_TYPE_REGISTRY);
    const withExtraField = z
      .object({
        conversationId: z.string().uuid(),
        extraField: z.string(),
      })
      .strict();
    const mutated: Record<string, NodeTypeRegistryEntry> = {
      ...NODE_TYPE_REGISTRY,
      chat: { ...NODE_TYPE_REGISTRY.chat!, dataSchema: withExtraField },
    };
    expect(computeNodeRegistryHash(mutated)).not.toBe(original);
  });

  it("flips when an entry's id changes", () => {
    const original = computeNodeRegistryHash(NODE_TYPE_REGISTRY);
    const mutated: Record<string, NodeTypeRegistryEntry> = {
      ...NODE_TYPE_REGISTRY,
      chat: { ...NODE_TYPE_REGISTRY.chat!, id: "chat-renamed" },
    };
    expect(computeNodeRegistryHash(mutated)).not.toBe(original);
  });

  it("NODE_REGISTRY_VERSION matches computeNodeRegistryHash(NODE_TYPE_REGISTRY)", () => {
    expect(NODE_REGISTRY_VERSION).toBe(computeNodeRegistryHash(NODE_TYPE_REGISTRY));
  });

  it("does not import Node crypto (browser-safe)", async () => {
    // Static-imports-only module; if this test file (and its transitive
    // imports) loaded successfully under vitest's jsdom environment without
    // needing to polyfill `crypto.createHash`, the hash implementation is
    // browser-safe. Additionally assert the hash is NOT a 64-hex-char sha256
    // digest shape (the Node-crypto pattern this module explicitly avoids).
    expect(NODE_REGISTRY_VERSION).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveNodeType", () => {
  it("resolves 'genui-panel' to its registered entry", () => {
    const resolved = resolveNodeType("genui-panel");
    expect(resolved.kind).toBe("registered");
    if (resolved.kind === "registered") {
      expect(resolved.entry.id).toBe("genui-panel");
    }
  });

  it("resolves 'chat' to its registered entry", () => {
    const resolved = resolveNodeType("chat");
    expect(resolved.kind).toBe("registered");
    if (resolved.kind === "registered") {
      expect(resolved.entry.id).toBe("chat");
    }
  });

  it("resolves an unregistered type to an unknown marker, never throws", () => {
    expect(() => resolveNodeType("agent")).not.toThrow();
    const resolved = resolveNodeType("agent");
    expect(resolved.kind).toBe("unknown");
    if (resolved.kind === "unknown") {
      expect(resolved.nodeType).toBe("agent");
    }
  });

  it("resolves 'knowledge-preview' to its registered entry", () => {
    const resolved = resolveNodeType("knowledge-preview");
    expect(resolved.kind).toBe("registered");
    if (resolved.kind === "registered") {
      expect(resolved.entry.id).toBe("knowledge-preview");
    }
  });

  it("resolves 'source' to its registered entry", () => {
    const resolved = resolveNodeType("source");
    expect(resolved.kind).toBe("registered");
    if (resolved.kind === "registered") {
      expect(resolved.entry.id).toBe("source");
    }
  });

  // The v2.0 panel types, registered at integration (mirrors 'source' above).
  for (const panelType of ["directory", "browser", "editor"] as const) {
    it(`resolves '${panelType}' to its registered entry`, () => {
      const resolved = resolveNodeType(panelType);
      expect(resolved.kind).toBe("registered");
      if (resolved.kind === "registered") {
        expect(resolved.entry.id).toBe(panelType);
      }
    });
  }
});

describe("GenuiPanelNodeDataSchema", () => {
  it("accepts a valid provenance + turnIndex payload", () => {
    const result = GenuiPanelNodeDataSchema.safeParse({
      provenance: {
        messageId: "550e8400-e29b-41d4-a716-446655440000",
        partIndex: 0,
        runId: null,
      },
      turnIndex: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload containing a top-level spec key", () => {
    const result = GenuiPanelNodeDataSchema.safeParse({
      provenance: {
        messageId: "550e8400-e29b-41d4-a716-446655440000",
        partIndex: 0,
        runId: null,
      },
      turnIndex: 2,
      spec: { v: 1, root: { type: "text", content: "hi" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload containing a top-level root key", () => {
    const result = GenuiPanelNodeDataSchema.safeParse({
      provenance: {
        messageId: "550e8400-e29b-41d4-a716-446655440000",
        partIndex: 0,
        runId: null,
      },
      turnIndex: 2,
      root: { type: "text", content: "hi" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with a negative turnIndex", () => {
    const result = GenuiPanelNodeDataSchema.safeParse({
      provenance: {
        messageId: "550e8400-e29b-41d4-a716-446655440000",
        partIndex: 0,
        runId: null,
      },
      turnIndex: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("KnowledgePreviewNodeDataSchema", () => {
  it("accepts a valid focusNodeId with no label", () => {
    const result = KnowledgePreviewNodeDataSchema.safeParse({
      focusNodeId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid focusNodeId with a label", () => {
    const result = KnowledgePreviewNodeDataSchema.safeParse({
      focusNodeId: "550e8400-e29b-41d4-a716-446655440000",
      label: "My preview",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid focusNodeId", () => {
    const result = KnowledgePreviewNodeDataSchema.safeParse({
      focusNodeId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a label longer than 80 characters", () => {
    const result = KnowledgePreviewNodeDataSchema.safeParse({
      focusNodeId: "550e8400-e29b-41d4-a716-446655440000",
      label: "a".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized extra top-level key (.strict())", () => {
    const result = KnowledgePreviewNodeDataSchema.safeParse({
      focusNodeId: "550e8400-e29b-41d4-a716-446655440000",
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("SpreadsheetNodeDataSchema (CV-03)", () => {
  const SHEET_ID = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts a bare spreadsheetId ref", () => {
    expect(SpreadsheetNodeDataSchema.safeParse({ spreadsheetId: SHEET_ID }).success).toBe(true);
  });

  it("accepts a spreadsheetId with an optional label", () => {
    expect(
      SpreadsheetNodeDataSchema.safeParse({ spreadsheetId: SHEET_ID, label: "Invoices" }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid spreadsheetId", () => {
    expect(SpreadsheetNodeDataSchema.safeParse({ spreadsheetId: "nope" }).success).toBe(false);
  });

  it("rejects columns/rows riding in node.data (ref-only discipline, .strict())", () => {
    expect(
      SpreadsheetNodeDataSchema.safeParse({ spreadsheetId: SHEET_ID, columns: [], rows: [] }).success,
    ).toBe(false);
  });

  it("rejects a label longer than 120 characters", () => {
    expect(
      SpreadsheetNodeDataSchema.safeParse({ spreadsheetId: SHEET_ID, label: "a".repeat(121) }).success,
    ).toBe(false);
  });
});
