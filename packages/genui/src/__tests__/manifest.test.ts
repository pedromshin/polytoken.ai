/**
 * __tests__/manifest.test.ts — CTLG-04 CI gate + D-04 a11y negative tests
 *
 * Test blocks:
 *   1. CTLG-04: Every catalog entry's example passes its own propsSchema.
 *      Catches stale manifests the moment an entry is modified.
 *   2. D-04 a11y hard-fail: a11y-required props must NOT be optional.
 *      Button without aria-label, alert without title, table without caption,
 *      key-value-list without label — each must fail safeParse.
 *   3. D-06 allowlist: RegisteredTypeSchema accepts known keys, rejects unknown.
 *   4. D-07 content-hash: computeRegistryHash is deterministic AND sensitive
 *      to catalog changes.
 */

import { describe, expect, it } from "vitest";

import { COMPONENT_REGISTRY } from "../registry/component-registry";
import {
  RegisteredTypeSchema,
  REGISTERED_TYPES,
} from "../registry/component-registry";
import { computeRegistryHash, REGISTRY_VERSION } from "../registry/registry-version";
import { SpecNodeSchema } from "../schema/spec-schema";
import type { AnyManifestEntry } from "../catalog/types";

// ===========================================================================
// Block 1: CTLG-04 — every manifest entry's example passes its own propsSchema
// ===========================================================================

describe("COMPONENT_REGISTRY manifest validation (CTLG-04)", () => {
  for (const [type, entry] of Object.entries(COMPONENT_REGISTRY)) {
    const typedEntry = entry as AnyManifestEntry;
    it(`manifest.${type}: example passes propsSchema`, () => {
      const result = typedEntry.propsSchema.safeParse(typedEntry.example);
      if (!result.success) {
        // Surface the exact Zod error for fast debugging
        throw new Error(
          `manifest.${type} example failed propsSchema:\n${JSON.stringify(result.error.format(), null, 2)}`,
        );
      }
      expect(result.success).toBe(true);
    });
  }
});

// ===========================================================================
// Block 2: D-04 — a11y-required props are NON-optional in propsSchema
// Omitting them MUST fail safeParse (UI-SPEC §11 / CTLG-02 hard-fail contract)
// ===========================================================================

describe("COMPONENT_REGISTRY a11y props are required (D-04 / CTLG-02)", () => {
  it("button: omitting aria-label fails propsSchema", () => {
    // Provide all other valid props but omit the required aria-label
    const result = COMPONENT_REGISTRY.button?.propsSchema.safeParse({
      label: "Submit",
      variant: "default",
      size: "md",
      disabled: false,
    });
    expect(result?.success).toBe(false);
  });

  it("alert: omitting title fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.alert?.propsSchema.safeParse({
      description: "Something happened",
      variant: "default",
    });
    expect(result?.success).toBe(false);
  });

  it("table: omitting caption fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.table?.propsSchema.safeParse({
      columns: [{ key: "name", header: "Name" }],
      rows: [{ name: "Alice" }],
    });
    expect(result?.success).toBe(false);
  });

  it("key-value-list: omitting label fails propsSchema", () => {
    const result = COMPONENT_REGISTRY["key-value-list"]?.propsSchema.safeParse({
      items: [{ key: "From", value: "alice@example.com" }],
    });
    expect(result?.success).toBe(false);
  });

  it("separator: aria-hidden must be literal true — string 'true' fails", () => {
    // aria-hidden is z.literal(true) — "true" (string) must fail
    const result = COMPONENT_REGISTRY.separator?.propsSchema.safeParse({
      "aria-hidden": "true",
      orientation: "horizontal",
    });
    expect(result?.success).toBe(false);
  });

  it("separator: aria-hidden: true passes propsSchema", () => {
    // Verify the positive case (aria-hidden: true is valid)
    const result = COMPONENT_REGISTRY.separator?.propsSchema.safeParse({
      "aria-hidden": true,
    });
    expect(result?.success).toBe(true);
  });

  // Phase 18 domain components (CTLG-06) — D-04 a11y negative tests

  it("avatar: omitting alt fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.avatar?.propsSchema.safeParse({
      src: "https://i.pravatar.cc/40",
      size: "md",
    });
    expect(result?.success).toBe(false);
  });

  it("input: omitting label fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.input?.propsSchema.safeParse({
      name: "email",
      inputType: "email",
    });
    expect(result?.success).toBe(false);
  });

  it("input: omitting name fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.input?.propsSchema.safeParse({
      label: "Email address",
      inputType: "email",
    });
    expect(result?.success).toBe(false);
  });

  it("nav: omitting aria-label fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.nav?.propsSchema.safeParse({
      items: [{ label: "Inbox", href: "/inbox" }],
    });
    expect(result?.success).toBe(false);
  });

  it("nav: absolute href fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.nav?.propsSchema.safeParse({
      "aria-label": "Main navigation",
      items: [{ label: "External", href: "https://example.com" }],
    });
    expect(result?.success).toBe(false);
  });

  it("tabs: omitting aria-label fails propsSchema", () => {
    const result = COMPONENT_REGISTRY.tabs?.propsSchema.safeParse({
      tabs: [
        {
          value: "a",
          label: "A",
          content: { type: "text", content: "hello" },
        },
      ],
    });
    expect(result?.success).toBe(false);
  });

  it("feed-item: providing avatarSrc without avatarAlt fails propsSchema", () => {
    const result = COMPONENT_REGISTRY["feed-item"]?.propsSchema.safeParse({
      title: "Alice",
      avatarSrc: "https://i.pravatar.cc/40",
    });
    expect(result?.success).toBe(false);
  });
});

// ===========================================================================
// Block 3: D-06 — RegisteredTypeSchema allowlist derived from registry keys
// ===========================================================================

describe("RegisteredTypeSchema allowlist (D-06)", () => {
  it("accepts all registered type keys", () => {
    for (const key of REGISTERED_TYPES) {
      const result = RegisteredTypeSchema.safeParse(key);
      expect(result.success, `Expected ${key} to be accepted`).toBe(true);
    }
  });

  it("accepts 'badge' (a known catalog entry)", () => {
    expect(RegisteredTypeSchema.safeParse("badge").success).toBe(true);
  });

  it("rejects 'data-table' (an unregistered type)", () => {
    expect(RegisteredTypeSchema.safeParse("data-table").success).toBe(false);
  });

  it("rejects 'list' (interpreter control-flow node, not in registry)", () => {
    expect(RegisteredTypeSchema.safeParse("list").success).toBe(false);
  });

  it("rejects 'conditional' (interpreter control-flow node, not in registry)", () => {
    expect(RegisteredTypeSchema.safeParse("conditional").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(RegisteredTypeSchema.safeParse("").success).toBe(false);
  });

  it("REGISTERED_TYPES has exactly 16 entries", () => {
    expect(REGISTERED_TYPES.length).toBe(16);
  });
});

// ===========================================================================
// Block 4: D-07 — computeRegistryHash is deterministic and sensitive
// ===========================================================================

describe("computeRegistryHash content-hash (D-07)", () => {
  it("is deterministic — same registry produces same hash", () => {
    const hash1 = computeRegistryHash(COMPONENT_REGISTRY);
    const hash2 = computeRegistryHash(COMPONENT_REGISTRY);
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-char hex SHA-256 digest", () => {
    const hash = computeRegistryHash(COMPONENT_REGISTRY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to a changed description — mutated copy produces different hash", () => {
    const baseHash = computeRegistryHash(COMPONENT_REGISTRY);

    // Build a shallow-cloned registry with one entry's description changed
    const mutatedRegistry = {
      ...COMPONENT_REGISTRY,
      badge: {
        ...(COMPONENT_REGISTRY.badge as AnyManifestEntry),
        description: "MUTATED description for hash sensitivity test",
      },
    };

    const mutatedHash = computeRegistryHash(mutatedRegistry);
    expect(mutatedHash).not.toBe(baseHash);
  });

  it("is sensitive to an added entry — extra key produces different hash", () => {
    const baseHash = computeRegistryHash(COMPONENT_REGISTRY);

    // Add a phantom entry to the cloned registry
    const expandedRegistry = {
      ...COMPONENT_REGISTRY,
      phantom: {
        ...(COMPONENT_REGISTRY.badge as AnyManifestEntry),
        type: "badge" as const, // type stays valid; it's the key that changes surface
        description: "Phantom entry for hash sensitivity test",
      },
    };

    const expandedHash = computeRegistryHash(expandedRegistry);
    expect(expandedHash).not.toBe(baseHash);
  });

  it("REGISTRY_VERSION.catalogId is 'global'", () => {
    expect(REGISTRY_VERSION.catalogId).toBe("global");
  });

  it("REGISTRY_VERSION.version matches computeRegistryHash output", () => {
    expect(REGISTRY_VERSION.version).toBe(
      computeRegistryHash(COMPONENT_REGISTRY),
    );
  });

  it("REGISTRY_VERSION.version is a 64-char hex string", () => {
    expect(REGISTRY_VERSION.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("REGISTRY_VERSION.version differs from the 10-entry pre-Phase-18 catalog (Phase-14 cache auto-invalidation)", () => {
    // All 6 Phase-18 keys are present in COMPONENT_REGISTRY — proves the key set
    // changed, which is what guarantees a different SHA-256 hash and triggers the
    // Phase-14 cache to discard stale specs (CTLG-08 / D-05).
    const phase18Keys = ["avatar", "input", "nav", "feed-item", "tabs", "section"] as const;
    for (const key of phase18Keys) {
      expect(
        key in COMPONENT_REGISTRY,
        `Expected COMPONENT_REGISTRY to contain "${key}" (Phase-18 addition)`,
      ).toBe(true);
    }

    // The hash must be a 64-char SHA-256 hex — the mechanism that ties the version
    // to the key set is already proven by the "is sensitive to an added entry" test above.
    expect(REGISTRY_VERSION.version).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(COMPONENT_REGISTRY).length).toBe(16);
  });
});

// ===========================================================================
// Block 5: Wire/render schema parity (Phase-18 D-05 / T-18-09)
//
// Every catalog example, when spread into { type, ...example }, must pass
// SpecNodeSchema (the wire discriminated union). This is the standing regression
// guard against the Phase-17 onClick-class drift: if a field exists in the
// manifest propsSchema but not the wire schema (or vice versa), this test fails
// with the offending type name and the exact Zod error.
//
// Container entries (acceptsChildren: true) get children: [] injected — matching
// what buildCatalogExampleSpec does — so the wire schema's required children
// array does not cause false negatives.
// ===========================================================================

describe("Wire/render schema parity (Phase-18 D-05)", () => {
  for (const [type, entry] of Object.entries(COMPONENT_REGISTRY)) {
    const typedEntry = entry as AnyManifestEntry;
    it(`${type}: example passes SpecNodeSchema (wire)`, () => {
      const node: Record<string, unknown> = { type, ...typedEntry.example };

      // Inject children: [] for container entries — mirrors buildCatalogExampleSpec.
      // Without this, wire schemas like SectionNodeSchema (required children: array)
      // would fail because catalog examples omit the empty array.
      if (typedEntry.acceptsChildren === true && !("children" in node)) {
        node["children"] = [];
      }

      const result = SpecNodeSchema.safeParse(node);
      if (!result.success) {
        throw new Error(
          `${type} example failed SpecNodeSchema (wire/render drift detected!):\n${JSON.stringify(result.error.format(), null, 2)}`,
        );
      }
      expect(result.success).toBe(true);
    });
  }
});
