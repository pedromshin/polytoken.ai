/**
 * canvas-capability-mirror.test.ts — the drift alarm for the AI-01 canvas-capability mirror.
 *
 * `@polytoken/capabilities`' canvas.ts hand-mirrors this canvas's node-type allowlist
 * (NODE_TYPE_REGISTRY ids + per-type Zod dataSchemas) because packages cannot import apps
 * (builtin-manifest.ts's honesty discipline restated). This test is the alarm that trips when
 * either side moves:
 *
 *   1. id-set equality — a type added/removed/renamed HERE must be re-mirrored THERE (and vice
 *      versa), or an agent could add a node the canvas can't render / be refused a node the
 *      canvas supports.
 *   2. fixture parity — for every type, a canonical VALID node.data is accepted by BOTH schemas
 *      and canonical HOSTILE payloads are rejected by BOTH (the mirror must not silently become
 *      looser or stricter than the canvas's own boundary).
 *
 * The render path's own contract is untouched by AI-01 and re-pinned here: `resolveNodeType`
 * NEVER throws on an unknown type (agent output stays fail-safe even against a legacy row).
 */

import { describe, expect, it } from "vitest";

import {
  CANVAS_NODE_DATA_SCHEMAS,
  CANVAS_NODE_TYPE_IDS,
} from "@polytoken/capabilities";

import { NODE_TYPE_REGISTRY, resolveNodeType } from "../node-type-registry";

const SOME_UUID = "00000000-0000-0000-0000-000000000002";
const CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";

/** Canonical VALID node.data per type (mirrors packages/capabilities' canvas.test.ts fixtures). */
const VALID_FIXTURES: Record<string, Record<string, unknown>> = {
  chat: { conversationId: CONVERSATION_ID },
  "genui-panel": {
    provenance: { messageId: SOME_UUID, partIndex: 0, runId: null },
    turnIndex: 0,
  },
  "knowledge-preview": { focusNodeId: SOME_UUID, label: "focus" },
  "email-thread": { threadId: SOME_UUID, label: "Renewal thread" },
  document: { documentId: SOME_UUID, label: "Q3 brief" },
  source: {
    sourceLedgerId: SOME_UUID,
    url: "https://example.com/article",
    title: "An article",
    excerpt: "short excerpt",
    tier: "suggested",
  },
  directory: {
    path: "/home/user/project",
    label: "project",
    entries: [{ name: "src", kind: "dir", depth: 0 }],
  },
  browser: { url: "https://example.com", label: "docs" },
  editor: { filePath: "/home/user/project/readme.md", language: "md" },
  desktop: { sessionId: "sess-1", status: "running", region: "eu-central", shape: "CPX41" },
  "circle-pack": { scope: "mailbox", label: "Mailbox landscape" },
  spreadsheet: { spreadsheetId: SOME_UUID, label: "Invoices" },
  file: { path: ["invoices", "2026"], name: "q3.pdf", label: "Q3 invoice" },
};

/** Canonical HOSTILE node.data per type — each violates the type's own boundary. */
const HOSTILE_FIXTURES: Record<string, Record<string, unknown>> = {
  chat: { conversationId: "not-a-uuid" },
  "genui-panel": { spec: { type: "card" } }, // D-05: no spec content in layout rows
  "knowledge-preview": { focusNodeId: SOME_UUID, smuggled: true }, // strict(): extra key
  "email-thread": { label: "no threadId ref" },
  document: { documentId: "not-a-uuid" },
  source: { sourceLedgerId: SOME_UUID, url: "javascript:alert(1)", title: "hostile" }, // T-61-04
  directory: { path: "" },
  browser: { url: "file:///etc/passwd" }, // filesystem read wearing a browser costume
  editor: { filePath: "/x", content: "smuggled file body" }, // ref-only: content never rides
  desktop: { sessionId: "s", gatewayUrl: "https://evil.example" }, // never a credential store
  "circle-pack": { scope: "mailbox", tree: [{ name: "smuggled" }] }, // strict(): no aggregated tree in node.data
  spreadsheet: { spreadsheetId: SOME_UUID, columns: [] }, // ref-only: columns/rows never ride in node.data
  file: { path: [".."], name: "passwd" }, // traversal segment — walks out of the user's vault prefix (T-66-07 restated)
};

describe("canvas capability mirror (AI-01 drift alarm)", () => {
  it("the capability allowlist is id-set-equal with NODE_TYPE_REGISTRY", () => {
    expect([...CANVAS_NODE_TYPE_IDS]).toEqual(Object.keys(NODE_TYPE_REGISTRY).sort());
  });

  it("every type has both fixtures declared (a new type must extend this alarm too)", () => {
    expect(Object.keys(VALID_FIXTURES).sort()).toEqual(Object.keys(NODE_TYPE_REGISTRY).sort());
    expect(Object.keys(HOSTILE_FIXTURES).sort()).toEqual(Object.keys(NODE_TYPE_REGISTRY).sort());
  });

  it("fixture parity: both schemas ACCEPT the canonical valid payload for every type", () => {
    for (const [id, data] of Object.entries(VALID_FIXTURES)) {
      const web = NODE_TYPE_REGISTRY[id]!.dataSchema.safeParse(data);
      const mirror = CANVAS_NODE_DATA_SCHEMAS[id]!.safeParse(data);
      expect(web.success, `web dataSchema for "${id}"`).toBe(true);
      expect(mirror.success, `mirrored dataSchema for "${id}"`).toBe(true);
    }
  });

  it("fixture parity: both schemas REJECT the canonical hostile payload for every type", () => {
    for (const [id, data] of Object.entries(HOSTILE_FIXTURES)) {
      const web = NODE_TYPE_REGISTRY[id]!.dataSchema.safeParse(data);
      const mirror = CANVAS_NODE_DATA_SCHEMAS[id]!.safeParse(data);
      expect(web.success, `web dataSchema for "${id}"`).toBe(false);
      expect(mirror.success, `mirrored dataSchema for "${id}"`).toBe(false);
    }
  });

  it("resolveNodeType still never throws on an unknown type (the AI-01 fail-safe backstop)", () => {
    expect(resolveNodeType("totally-made-up")).toEqual({
      kind: "unknown",
      nodeType: "totally-made-up",
    });
  });
});
