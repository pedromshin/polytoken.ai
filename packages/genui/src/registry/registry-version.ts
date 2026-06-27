/**
 * registry/registry-version.ts — Content-hash registry version identifier.
 *
 * Produces a deterministic SHA-256 hash over the catalog's type keys,
 * entry descriptions, examples, slot rules, and lockedProps.
 * ANY change to a catalog entry flips the hash (D-07 / T-12-08).
 *
 * Exposed as `REGISTRY_VERSION: { catalogId: string; version: string }`
 * with shape `{ catalogId: "global", version: <64-hex sha256> }`.
 *
 * Phase 14 consumes REGISTRY_VERSION.version as its cache key (CACHE-04 seam).
 * The { catalogId, version } shape leaves room for per-tenant catalogs with
 * no downstream schema change (D-21 / SEAM-03).
 *
 * Implementation note:
 *   - Uses Node.js built-in `crypto` (`createHash`) — no third-party dep.
 *   - propsSchema Zod objects are not directly JSON-serializable, so the stable
 *     serialization surface is: sorted type keys + description + example
 *     (JSON.stringify) + slots + acceptsChildren + lockedProps.
 *     Any modification to any of these fields flips the hash (D-07).
 *   - Keys are sorted before hashing so insertion order is irrelevant.
 */

import { createHash } from "crypto";

import type { ComponentRegistry } from "../catalog/types";
import { COMPONENT_REGISTRY } from "./component-registry";

// ---------------------------------------------------------------------------
// computeRegistryHash
// ---------------------------------------------------------------------------

/**
 * Produces a stable SHA-256 hex digest over the registry's public surface.
 *
 * Serialization is deterministic:
 *   1. Sort entries by type key (alphabetical).
 *   2. For each entry: JSON.stringify({ type, description, example, slots,
 *      acceptsChildren, lockedProps }).
 *   3. Concatenate all serialized entries separated by "\n".
 *   4. Hash with SHA-256.
 *
 * Sensitive to:
 *   - Adding / removing catalog entries (key sort changes)
 *   - Changing description, example, slots, acceptsChildren, lockedProps
 *   - Reordering items inside example, slots, or lockedProps arrays
 *
 * NOT sensitive to:
 *   - Entry insertion order in the registry (keys are sorted)
 */
export function computeRegistryHash(registry: ComponentRegistry): string {
  const sortedKeys = Object.keys(registry).slice().sort();

  const serialized = sortedKeys
    .map((key) => {
      const entry = registry[key];
      if (!entry) return "";
      return JSON.stringify({
        type: entry.type,
        description: entry.description,
        example: entry.example,
        slots: entry.slots ?? [],
        acceptsChildren: entry.acceptsChildren ?? false,
        lockedProps: entry.lockedProps ?? [],
      });
    })
    .join("\n");

  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// REGISTRY_VERSION — the content-hash version identifier
//
// Shape: { catalogId: "global", version: <64-hex sha256> }
//   catalogId — reserved for per-tenant catalogs (SEAM-03 / D-21). "global" is
//               the only value used in v1.1; Phase 14 will read this field when
//               building its cache key, so the shape is stable across tenants.
//   version   — SHA-256 digest; 64 hex chars. Phase 14 uses `version.slice(0,8)`
//               for the UI chip (UI-SPEC §12).
// ---------------------------------------------------------------------------

/** The content-hash version identifier for the current COMPONENT_REGISTRY. */
export const REGISTRY_VERSION: {
  readonly catalogId: string;
  readonly version: string;
} = {
  catalogId: "global",
  version: computeRegistryHash(COMPONENT_REGISTRY),
};
