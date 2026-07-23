/**
 * projection-map.test.ts — the AI-02 enforcement gate: every builtin capability's four
 * INV-1 projections (LLM tool, /capabilities card, genui block, canvas node) are DECLARED,
 * and every declared face RESOLVES.
 *
 * Design rule (AI-02): the assertions run over the DECLARED projections in projection-map.ts.
 * A capability whose face deliberately does not exist yet carries an explicit
 * `{ status: "exception", reason }` — auditable data — so this suite has NO per-capability
 * special cases. Consequences:
 *
 *   - a future capability added to BUILTIN_CAPABILITY_MANIFEST without a projection
 *     declaration fails the bijection test (ships incomplete → suite red);
 *   - a declared genui `componentType` that is not in @polytoken/genui's COMPONENT_REGISTRY
 *     fails; a declared canvas nodeType outside the node-type allowlist fails;
 *   - a silent gap is impossible: every face must be either wired or a written-down exception.
 *
 * Cross-process honesty: daemon/chat descriptors cannot be imported here (same boundary as
 * builtin-manifest.test.ts), so their tool face pins declaringSource paths. The four desktop.*
 * capabilities DO have in-process descriptors (@polytoken/capabilities DESKTOP_CAPABILITIES),
 * so their tool face is asserted against the REAL registry objects — describe/risk/cost/
 * reversibility must match the manifest mirror, and input/output must be real Zod schemas
 * (a valid LLM tool definition needs both describe and an input schema).
 *
 * The canvas node-type mirror itself is cross-checked against the live NODE_TYPE_REGISTRY by
 * apps/web/src/app/capabilities/__tests__/projection-canvas-sync.test.ts (apps/web may import
 * this package; this package may never import apps/web).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DESKTOP_CAPABILITIES } from "@polytoken/capabilities";
import { CapabilityBindingSchema } from "@polytoken/genui/binding";
import { REGISTERED_TYPES } from "@polytoken/genui/registry";

import { BUILTIN_CAPABILITY_MANIFEST } from "../builtin-manifest";
import {
  CANVAS_NODE_TYPE_IDS,
  CAPABILITY_PROJECTIONS,
  getCapabilityProjection,
} from "../projection-map";

// ---------------------------------------------------------------------------
// The declaration grammar, as a schema — a malformed face fails structurally,
// before any resolution assertion runs.
// ---------------------------------------------------------------------------

/** An exception must EXPLAIN itself — a one-liner excuse is not an audit trail. */
const exceptionSchema = z
  .object({
    status: z.literal("exception"),
    reason: z.string().min(60, "exception reasons must be real explanations (>= 60 chars)"),
  })
  .strict();

const toolSchema = z.union([
  z
    .object({
      status: z.enum(["live", "declared"]),
      declaringSource: z
        .string()
        .regex(/^(apps|packages)\/[a-z-]+\/.+\.(ts|py)$/, "declaringSource must be a repo path"),
    })
    .strict(),
  exceptionSchema,
]);

const cardSchema = z.union([z.object({ status: z.literal("wired") }).strict(), exceptionSchema]);

const genuiSchema = z.union([
  z.object({ status: z.literal("wired"), via: z.literal("binding") }).strict(),
  z
    .object({
      status: z.literal("wired"),
      via: z.literal("component"),
      componentType: z.string().min(1),
    })
    .strict(),
  exceptionSchema,
]);

const canvasSchema = z.union([
  z
    .object({
      status: z.literal("wired"),
      nodeType: z.enum(CANVAS_NODE_TYPE_IDS as unknown as [string, ...string[]]),
    })
    .strict(),
  exceptionSchema,
]);

const declarationSchema = z
  .object({
    id: z.string().min(1),
    tool: toolSchema,
    card: cardSchema,
    genui: genuiSchema,
    canvas: canvasSchema,
  })
  .strict();

describe("CAPABILITY_PROJECTIONS — the AI-02 four-face gate", () => {
  it("covers the manifest bijectively: every capability declares its projections, no orphans", () => {
    const manifestIds = BUILTIN_CAPABILITY_MANIFEST.map((e) => e.id).sort();
    const declaredIds = CAPABILITY_PROJECTIONS.map((p) => p.id).sort();
    // A new capability added to the manifest WITHOUT a projection declaration fails HERE —
    // this is the "ships incomplete → build red" check AI-02 calls for.
    expect(declaredIds).toEqual(manifestIds);
  });

  it("every declaration parses the projection grammar (all four faces present, exceptions explained)", () => {
    for (const declaration of CAPABILITY_PROJECTIONS) {
      const parsed = declarationSchema.safeParse(declaration);
      expect(
        parsed.success,
        `"${declaration.id}": ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it("tool face: manifest describe is a usable tool description for every non-exception tool", () => {
    for (const entry of BUILTIN_CAPABILITY_MANIFEST) {
      const projection = getCapabilityProjection(entry.id);
      expect(projection, `"${entry.id}" has no projection declaration`).toBeDefined();
      if (projection?.tool.status === "exception") continue;
      // The manifest entry IS the outward tool definition half: id + describe.
      expect(entry.describe.trim().length, `"${entry.id}" describe too short`).toBeGreaterThan(20);
      expect(entry.describe.length, `"${entry.id}" describe blows the tool-description budget`)
        .toBeLessThanOrEqual(1024);
    }
  });

  it("tool face: 'live' is reserved for the chat registry (the only tool loop running today)", () => {
    for (const projection of CAPABILITY_PROJECTIONS) {
      if (projection.tool.status !== "live") continue;
      const entry = BUILTIN_CAPABILITY_MANIFEST.find((e) => e.id === projection.id);
      expect(entry?.origin, `"${projection.id}" declares a live tool but is not chat-origin`).toBe(
        "chat",
      );
      // Chat tool ids go straight to the model as tool names — keep them tool-name-safe.
      expect(projection.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(projection.tool.declaringSource).toBe(
        "apps/email-listener/app/application/capabilities/registry.py",
      );
    }
  });

  it("tool face: desktop.* declarations resolve against the REAL in-process descriptors", () => {
    const desktopIds = CAPABILITY_PROJECTIONS.filter(
      (p) =>
        p.tool.status !== "exception" &&
        p.tool.declaringSource === "packages/capabilities/src/desktop.ts",
    ).map((p) => p.id);
    expect(desktopIds.sort()).toEqual(
      ["desktop.attach", "desktop.destroy", "desktop.hibernate", "desktop.spawn"].sort(),
    );

    for (const id of desktopIds) {
      const descriptor = DESKTOP_CAPABILITIES.find((c) => c.id === id);
      const mirror = BUILTIN_CAPABILITY_MANIFEST.find((e) => e.id === id);
      expect(descriptor, `"${id}" not found in DESKTOP_CAPABILITIES`).toBeDefined();
      if (descriptor === undefined || mirror === undefined) continue;
      // A valid LLM tool definition = describe + a real input schema (+ output for genui).
      expect(typeof descriptor.input.safeParse).toBe("function");
      expect(typeof descriptor.output.safeParse).toBe("function");
      // The static mirror must not drift from the declaring source we CAN reach.
      expect(mirror.describe).toBe(descriptor.describe);
      expect(mirror.risk).toBe(descriptor.risk);
      expect(mirror.cost).toBe(descriptor.cost);
      if (descriptor.reversibility === undefined) {
        expect(mirror).not.toHaveProperty("reversibility");
      } else {
        expect(mirror.reversibility).toBe(descriptor.reversibility);
      }
    }
  });

  it("card face: every capability is wired to the /capabilities panel (no card exceptions exist)", () => {
    // The panel maps the whole manifest — a card exception would mean a capability the user
    // cannot see or switch off, which the allowlist surface's contract forbids.
    for (const projection of CAPABILITY_PROJECTIONS) {
      expect(projection.card, `"${projection.id}" lost its allowlist card`).toEqual({
        status: "wired",
      });
    }
  });

  it("genui face: binding-wired ids are grammatically bindable; component-wired ids exist in the catalog", () => {
    for (const projection of CAPABILITY_PROJECTIONS) {
      if (projection.genui.status === "exception") continue;
      if (projection.genui.via === "binding") {
        // The spec-side descriptor must accept this id — resolution then happens against the
        // executing surface's registry and fails closed elsewhere (INV-5).
        const parsed = CapabilityBindingSchema.safeParse({ capabilityId: projection.id });
        expect(parsed.success, `"${projection.id}" is not bindable`).toBe(true);
      } else {
        // A dedicated genui component face must actually be registered (D-06 allowlist).
        expect(
          REGISTERED_TYPES,
          `"${projection.id}" declares genui component "${projection.genui.componentType}" but the catalog has no such entry`,
        ).toContain(projection.genui.componentType);
      }
    }
  });

  it("canvas face: every wired node type is in the canvas allowlist mirror", () => {
    for (const projection of CAPABILITY_PROJECTIONS) {
      if (projection.canvas.status === "exception") continue;
      expect(
        CANVAS_NODE_TYPE_IDS,
        `"${projection.id}" declares unregistered canvas node "${projection.canvas.nodeType}"`,
      ).toContain(projection.canvas.nodeType);
    }
  });

  it("pins today's exception set — closing one must update the declaration, not this list silently", () => {
    const exceptions = CAPABILITY_PROJECTIONS.flatMap((p) =>
      (["tool", "card", "genui", "canvas"] as const)
        .filter((face) => p[face].status === "exception")
        .map((face) => `${p.id}:${face}`),
    ).sort();
    // The three known canvas gaps (no terminal node, no git node, no entity node). Anything
    // appearing or disappearing here is a deliberate roadmap event and must be reviewed.
    expect(exceptions).toEqual(["git:canvas", "lookup_entity:canvas", "terminal.exec:canvas"]);
  });

  it("getCapabilityProjection resolves every manifest id and fails closed on unknowns", () => {
    for (const entry of BUILTIN_CAPABILITY_MANIFEST) {
      expect(getCapabilityProjection(entry.id)?.id).toBe(entry.id);
    }
    expect(getCapabilityProjection("no.such.capability")).toBeUndefined();
  });
});
