/**
 * catalogue.test.ts — the expose-allowlist drift gate (MCPX-01, MCPX-02).
 *
 * Parity with `projection-map.test.ts` discipline: the allowlist is asserted against the
 * honest `BUILTIN_CAPABILITY_MANIFEST`, so a capability whose `describe`/`risk` drifts at its
 * source, or a tool wired to a non-read / non-existent id, trips this suite (and, because the
 * guards throw at module load, the server refuses to start too).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  BUILTIN_CAPABILITY_MANIFEST,
  listInputSchema,
  omniboxSearchInputSchema,
  searchKnowledgeInputSchema,
} from "@polytoken/api-client";

import {
  assertZodSchema,
  EXPOSED_TOOLS,
  getExposedTool,
  readManifestEntry,
} from "../catalogue";

describe("EXPOSED_TOOLS — MCPX-01 (manifest drift gate)", () => {
  it("exposes exactly the three allowlisted tools", () => {
    expect(EXPOSED_TOOLS.map((t) => t.toolName).sort()).toEqual([
      "polytoken.listEntities",
      "polytoken.searchEverything",
      "polytoken.searchMyKnowledge",
    ]);
  });

  it("every tool name is polytoken-namespaced", () => {
    for (const tool of EXPOSED_TOOLS) {
      expect(tool.toolName.startsWith("polytoken.")).toBe(true);
    }
  });

  it("every manifest-backed id exists in BUILTIN_CAPABILITY_MANIFEST with risk:\"read\"", () => {
    for (const tool of EXPOSED_TOOLS) {
      if (tool.capabilityId === undefined) continue;
      const entry = BUILTIN_CAPABILITY_MANIFEST.find((e) => e.id === tool.capabilityId);
      expect(entry, `"${tool.capabilityId}" missing from manifest`).toBeDefined();
      expect(entry?.risk).toBe("read");
    }
  });

  it("manifest-backed tools carry a usable, procedure-accurate description (NOT the verbatim manifest describe)", () => {
    // The risk:"read" + id∈manifest guard (above) is the machine-checked invariant.
    // The description is AUTHORED to match the actual dispatch target: the manifest
    // `describe` is written for the broader Python chat executors (id-lookup for
    // lookup_entity, graph-expand for search_knowledge) and over-promises what the
    // read procedure this tool dispatches to can do, so we deliberately do NOT
    // present it verbatim. Guard against the over-promise regressing back in.
    for (const tool of EXPOSED_TOOLS) {
      if (tool.capabilityId === undefined) continue;
      expect(tool.description.length).toBeGreaterThan(20);
      // The chat-executor over-promises the read procedures cannot honour.
      expect(tool.description.toLowerCase()).not.toContain("expand");
      expect(tool.description.toLowerCase()).not.toContain("entity_instance id");
    }
  });

  it("pins the manifest-backed id ↔ tool mapping (a new mapping is a reviewed event)", () => {
    const backed = EXPOSED_TOOLS.filter((t) => t.capabilityId !== undefined).map(
      (t) => `${t.capabilityId}->${t.toolName}`,
    );
    expect(backed.sort()).toEqual([
      "lookup_entity->polytoken.listEntities",
      "search_knowledge->polytoken.searchMyKnowledge",
    ]);
  });

  it("the procedure-backed tool (search.omnibox) carries a usable authored description", () => {
    const omni = getExposedTool("polytoken.searchEverything");
    expect(omni).toBeDefined();
    expect(omni?.capabilityId).toBeUndefined();
    expect((omni?.description ?? "").length).toBeGreaterThan(20);
  });

  it("readManifestEntry refuses non-existent and non-read ids (registration fails closed)", () => {
    expect(() => readManifestEntry("no.such.capability")).toThrow();
    // canvas.addNode is risk:"write" — must never be exposable through this read allowlist.
    expect(() => readManifestEntry("canvas.addNode")).toThrow(/risk="write"/);
    expect(readManifestEntry("search_knowledge").risk).toBe("read");
  });
});

describe("EXPOSED_TOOLS — MCPX-02 (inputSchema from Zod)", () => {
  it("each inputSchema is the zod-to-json-schema conversion of the tool's Zod input", () => {
    for (const tool of EXPOSED_TOOLS) {
      expect(tool.inputJsonSchema).toEqual(
        zodToJsonSchema(tool.toolInputSchema) as Record<string, unknown>,
      );
      // A usable object schema exposing a `query` property.
      const props = (tool.inputJsonSchema as { properties?: Record<string, unknown> })
        .properties;
      expect(props).toBeDefined();
      expect(props).toHaveProperty("query");
    }
  });

  it("each tool re-parses against the procedure's OWN exported Zod schema", () => {
    // Identity check: the dispatch-boundary schema IS the procedure's exported schema.
    expect(getExposedTool("polytoken.searchMyKnowledge")?.procedureInputSchema).toBe(
      searchKnowledgeInputSchema,
    );
    expect(getExposedTool("polytoken.listEntities")?.procedureInputSchema).toBe(
      listInputSchema,
    );
    expect(getExposedTool("polytoken.searchEverything")?.procedureInputSchema).toBe(
      omniboxSearchInputSchema,
    );
  });

  it("a tool with no valid Zod source is refused at registration (MCPX-02)", () => {
    expect(() => assertZodSchema({}, "bogus")).toThrow(/not a valid Zod schema/);
    expect(() => assertZodSchema(undefined, "bogus")).toThrow();
    // A real Zod schema passes.
    expect(() => assertZodSchema(z.object({ query: z.string() }), "ok")).not.toThrow();
  });
});
