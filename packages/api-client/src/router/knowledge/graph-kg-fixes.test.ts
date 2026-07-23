/**
 * graph-kg-fixes.test.ts — behavioral tests for the read-layer halves of
 * KG-2 and KG-3 (2026-07-22 email-system-review report).
 *
 * KG-2: a promoted (active EXTRACTED) edge must never be shadowed by an
 *       INFERRED/AMBIGUOUS duplicate of the same (source, target, relation)
 *       identity — the user already promoted that relation once.
 * KG-3: knowledge→entity_instance edge targets absent from the emitted node
 *       set must be reported so the procedure can fetch them — otherwise the
 *       frontend's both-endpoints-visible filter silently drops the
 *       'about'/'possibly_about' edges the report is about.
 *
 * DB-free: both helpers are pure functions exported from graph.ts.
 */

import { describe, expect, it } from "vitest";

import {
  collectMissingEntityInstanceTargets,
  dedupeShadowedSuggestionEdges,
  type ExplicitEdgeRow,
} from "./graph";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function edge(
  overrides: Partial<ExplicitEdgeRow> & { id: string },
): ExplicitEdgeRow {
  return {
    sourceNodeId: "kn-1",
    targetRefId: "inst-1",
    targetRefType: "entity_instance",
    relationType: "about",
    tier: "INFERRED",
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// KG-2 — dedupeShadowedSuggestionEdges
// ---------------------------------------------------------------------------

describe("dedupeShadowedSuggestionEdges (KG-2)", () => {
  it("drops an INFERRED duplicate of an active EXTRACTED edge with the same identity", () => {
    const promoted = edge({ id: "e1", tier: "EXTRACTED" });
    const resurrectedSuggestion = edge({ id: "e2", tier: "INFERRED" });

    const result = dedupeShadowedSuggestionEdges([promoted, resurrectedSuggestion]);

    expect(result.map((r) => r.id)).toEqual(["e1"]);
  });

  it("drops an AMBIGUOUS duplicate too", () => {
    const promoted = edge({ id: "e1", tier: "EXTRACTED" });
    const dup = edge({ id: "e2", tier: "AMBIGUOUS" });

    const result = dedupeShadowedSuggestionEdges([dup, promoted]);

    expect(result.map((r) => r.id)).toEqual(["e1"]);
  });

  it("keeps a suggestion whose identity differs in ANY of source/target/relation", () => {
    const promoted = edge({ id: "e1", tier: "EXTRACTED" });
    const otherTarget = edge({ id: "e2", targetRefId: "inst-2" });
    const otherRelation = edge({ id: "e3", relationType: "possibly_about" });
    const otherSource = edge({ id: "e4", sourceNodeId: "kn-2" });

    const result = dedupeShadowedSuggestionEdges([
      promoted,
      otherTarget,
      otherRelation,
      otherSource,
    ]);

    expect(result.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("an INACTIVE extracted edge does not shadow the suggestion (nothing to keep instead)", () => {
    const deactivatedPromoted = edge({ id: "e1", tier: "EXTRACTED", isActive: false });
    const suggestion = edge({ id: "e2", tier: "INFERRED" });

    const result = dedupeShadowedSuggestionEdges([deactivatedPromoted, suggestion]);

    // Both survive dedupe; shapeExplicitEdgeRow later excludes the inactive
    // row — the suggestion remains the only visible edge, matching pre-fix
    // behavior for genuinely-demoted data.
    expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("suggestions with a null target are never dropped", () => {
    const promoted = edge({ id: "e1", tier: "EXTRACTED", targetRefId: null });
    const nullTargetSuggestion = edge({ id: "e2", targetRefId: null });

    const result = dedupeShadowedSuggestionEdges([promoted, nullTargetSuggestion]);

    expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("order does not matter — the EXTRACTED edge can come after the suggestion", () => {
    const suggestion = edge({ id: "e2", tier: "INFERRED" });
    const promoted = edge({ id: "e1", tier: "EXTRACTED" });

    const result = dedupeShadowedSuggestionEdges([suggestion, promoted]);

    expect(result.map((r) => r.id)).toEqual(["e1"]);
  });

  it("never mutates its input", () => {
    const rows = [edge({ id: "e1", tier: "EXTRACTED" }), edge({ id: "e2" })];
    const snapshot = [...rows];
    dedupeShadowedSuggestionEdges(rows);
    expect(rows).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// KG-3 — collectMissingEntityInstanceTargets
// ---------------------------------------------------------------------------

describe("collectMissingEntityInstanceTargets (KG-3)", () => {
  it("reports an entity_instance target absent from the emitted node set", () => {
    const rows = [edge({ id: "e1", relationType: "about", targetRefId: "inst-9" })];

    const missing = collectMissingEntityInstanceTargets(rows, new Set(["kn-1"]));

    expect(missing).toEqual(["inst-9"]);
  });

  it("skips targets already emitted as nodes", () => {
    const rows = [edge({ id: "e1", targetRefId: "inst-9" })];

    const missing = collectMissingEntityInstanceTargets(
      rows,
      new Set(["kn-1", "inst-9"]),
    );

    expect(missing).toEqual([]);
  });

  it("ignores non-entity_instance targets and inactive edges", () => {
    const rows = [
      edge({ id: "e1", targetRefType: "email_component", targetRefId: "comp-1" }),
      edge({ id: "e2", targetRefType: null, targetRefId: "x-1" }),
      edge({ id: "e3", isActive: false, targetRefId: "inst-dead" }),
      edge({ id: "e4", targetRefId: null }),
    ];

    const missing = collectMissingEntityInstanceTargets(rows, new Set());

    expect(missing).toEqual([]);
  });

  it("de-duplicates: two edges to the same instance report it once", () => {
    const rows = [
      edge({ id: "e1", relationType: "about", targetRefId: "inst-9" }),
      edge({ id: "e2", relationType: "possibly_about", targetRefId: "inst-9" }),
    ];

    const missing = collectMissingEntityInstanceTargets(rows, new Set());

    expect(missing).toEqual(["inst-9"]);
  });

  it("collects across multiple source nodes", () => {
    const rows = [
      edge({ id: "e1", sourceNodeId: "kn-1", targetRefId: "inst-1" }),
      edge({ id: "e2", sourceNodeId: "kn-2", targetRefId: "inst-2" }),
    ];

    const missing = collectMissingEntityInstanceTargets(rows, new Set());

    expect(missing.sort()).toEqual(["inst-1", "inst-2"]);
  });
});
