/**
 * canvas-vocabulary.test.ts — 61-02-PLAN.md Task 2 (tdd="true"): RED before
 * `canvas-vocabulary.ts` exists, GREEN after. Task 3 extends this file into
 * the full edge-tier x node-kind matrix gate.
 *
 * THE RETIRED NODE-TYPE FAMILY IS NEVER WRITTEN OUT IN THIS FILE. It is
 * assembled from parts, exactly as `role-hue-ban.test.ts` does. Phase 61 will
 * append `chat/` to that gate's `SCOPED_DIRS` ratchet as it sweeps (61-04/05),
 * at which point this file falls inside the walked scope — and a literal
 * colour-prefixed token here would make this gate execute itself.
 */

import { describe, expect, it } from "vitest";

import { TIER_HUE_FAMILY, TIER_IS_DASHED, type Tier } from "../../../_vocabulary/tier";
// A deliberate cross-surface import, and the ONLY one here: asserting that the
// two surfaces agree is this gate's job, and it cannot be done from one side.
import { REGION_TIER } from "../../../emails/[id]/_components/region-vocabulary";
import {
  CANVAS_EDGE_TIER,
  CANVAS_NODE_KIND_GEOMETRY,
  CANVAS_NODE_KIND_LABEL,
  canvasNodeKindOf,
  type CanvasEdgeTier,
  type CanvasNodeKind,
} from "../canvas-vocabulary";
import { NODE_TYPE_REGISTRY } from "../node-type-registry";

const EDGE_TIERS: readonly CanvasEdgeTier[] = ["neutral", "confirmed", "suggested"];
const NODE_KINDS: readonly CanvasNodeKind[] = [
  "chat",
  "genui-panel",
  "email-thread",
  "knowledge-preview",
  "document",
  "source",
  "directory",
  "browser",
  "editor",
  "desktop",
  "circle-pack",
  "unknown",
];

/** See the header — assembled, never written out. */
const RETIRED_NODE_TYPE_FAMILY = ["gra", "ph"].join("") + "-";

/**
 * WHICH TIER EACH EDGE KIND CLAIMS. This is the only fact this test states on
 * its own, because it is the canvas's own semantic decision: a `neutral` edge
 * is a data wire — plumbing, not provenance — so it claims NO tier and (law 1:
 * colour is earned) earns no hue.
 *
 * What each claim LOOKS like is never restated here; it is derived from
 * TIER_HUE_FAMILY/TIER_IS_DASHED below. A test that hardcoded the appearance
 * would be a third map of the same fact.
 */
const EDGE_TIER_CLAIM: Record<CanvasEdgeTier, Tier | null> = {
  neutral: null,
  confirmed: "confirmed",
  suggested: "suggested",
};

/** The canvas draws SVG paths, so its idiom for "dashed" is a stroke-dasharray. */
const DASH_IDIOM = "dasharray";

function edgeStrings(tier: CanvasEdgeTier): string[] {
  const { path, joint } = CANVAS_EDGE_TIER[tier];
  return [path, joint];
}

describe("CANVAS_EDGE_TIER — tier owns colour and solid-vs-dashed, and nothing else does", () => {
  it("neutral makes NO tier claim, so it carries no hue and no dash (law 1: colour is earned)", () => {
    // The ONLY edge /chat renders today is a DataEdge wiring sourcePath ->
    // targetKey. That is plumbing, not provenance. It has no tier to state, so
    // it gets the sketch's `.e-neutral` and no colour whatsoever.
    for (const value of edgeStrings("neutral")) {
      expect(value).not.toContain("conf");
      expect(value).not.toContain("sugg");
      expect(value).not.toContain(DASH_IDIOM);
    }
  });

  for (const tier of EDGE_TIERS) {
    it(`${tier}: hue and dash follow the SHARED facts, not a second opinion`, () => {
      const claim = EDGE_TIER_CLAIM[tier];
      const family = claim === null ? null : TIER_HUE_FAMILY[claim];
      const isDashed = claim === null ? false : TIER_IS_DASHED[claim];
      const { path } = CANVAS_EDGE_TIER[tier];

      if (family === null) {
        expect(path, `${tier}.path must carry no tier hue`).not.toContain("conf");
        expect(path, `${tier}.path must carry no tier hue`).not.toContain("sugg");
      } else {
        expect(path, `${tier}.path must carry the ${family} family`).toContain(family);
      }

      expect(path.includes(DASH_IDIOM), `${tier}.path dashedness`).toBe(isDashed);
    });

    it(`${tier}: the joint dot matches its path's colour`, () => {
      const claim = EDGE_TIER_CLAIM[tier];
      const family = claim === null ? null : TIER_HUE_FAMILY[claim];
      const { joint } = CANVAS_EDGE_TIER[tier];

      if (family === null) {
        expect(joint).not.toContain("conf");
        expect(joint).not.toContain("sugg");
      } else {
        expect(joint, `${tier}.joint must carry the ${family} family`).toContain(family);
      }
    });
  }

  it("every edge tier is a fill/stroke lookup — no value carries a retired node-type token", () => {
    for (const tier of EDGE_TIERS) {
      for (const value of edgeStrings(tier)) {
        expect(value).not.toContain(RETIRED_NODE_TYPE_FAMILY);
      }
    }
  });
});

describe("canvasNodeKindOf — a persisted node.type is untrusted (T-61-06)", () => {
  it("resolves every registered node type to its own kind", () => {
    expect(canvasNodeKindOf("chat")).toBe("chat");
    expect(canvasNodeKindOf("genui-panel")).toBe("genui-panel");
    expect(canvasNodeKindOf("email-thread")).toBe("email-thread");
    expect(canvasNodeKindOf("knowledge-preview")).toBe("knowledge-preview");
    expect(canvasNodeKindOf("document")).toBe("document");
    expect(canvasNodeKindOf("source")).toBe("source");
    expect(canvasNodeKindOf("directory")).toBe("directory");
    expect(canvasNodeKindOf("browser")).toBe("browser");
    expect(canvasNodeKindOf("editor")).toBe("editor");
    expect(canvasNodeKindOf("circle-pack")).toBe("circle-pack");
  });

  it("resolves an UNRECOGNIZED type to \"unknown\" — never throws, never another kind's geometry", () => {
    // `node.type` arrives from chat_canvas_layouts, a user-writable row.
    // CANVAS-03's posture is degrade-gracefully: a legacy or hostile type
    // renders the placeholder, it does not crash the canvas.
    const hostile = [
      "",
      "not-a-node-type",
      "__proto__",
      "constructor",
      "toString",
      "chat ",
      "CHAT",
      "<script>alert(1)</script>",
    ];
    for (const type of hostile) {
      expect(canvasNodeKindOf(type), `canvasNodeKindOf(${JSON.stringify(type)})`).toBe("unknown");
    }
  });

  it("recognizes EXACTLY the node types the registry registers — one mapping, not two", () => {
    // If a fifth node type is registered and this vocabulary is not grown to
    // match, `canvasNodeKindOf` quietly answers "unknown" and the new node
    // renders as a degraded placeholder frame forever. That drift is a red
    // test here rather than a mystery on the canvas.
    const registered = Object.keys(NODE_TYPE_REGISTRY).sort();
    const known = NODE_KINDS.filter((kind) => kind !== "unknown").sort();
    expect(known).toEqual(registered);
  });
});

describe("CANVAS_NODE_KIND_GEOMETRY — kind is shape, never hue (law 3)", () => {
  /**
   * Bans a TIER or RETIRED-family token behind any colour-bearing prefix.
   * Chrome ink is deliberately allowed: `border-l-ink` is how the chat node's
   * left rule states "this is the conversation" without reaching for a hue.
   */
  const TIER_OR_RETIRED_HUE_PATTERN = new RegExp(
    `\\b(?:bg|text|border|border-[lrtxy]|ring|fill|stroke|from|via|to|outline|decoration|shadow|accent|divide)-(?:conf|sugg|${["gra", "ph"].join("")})`,
  );

  it("no kind's geometry names a tier or a retired node-type colour", () => {
    for (const kind of NODE_KINDS) {
      expect(CANVAS_NODE_KIND_GEOMETRY[kind], `${kind} geometry`).not.toMatch(
        TIER_OR_RETIRED_HUE_PATTERN,
      );
    }
  });

  it("no kind's geometry uses border-dashed — tier already owns solid-vs-dashed", () => {
    // The one collision on this surface, respected exactly as
    // region-vocabulary.ts respects it with `unrelated` (dotted, not dashed).
    for (const kind of NODE_KINDS) {
      expect(CANVAS_NODE_KIND_GEOMETRY[kind], `${kind} geometry`).not.toContain("dashed");
    }
  });

  it("every kind is structurally DISTINCT — kind is re-encoded, not deleted", () => {
    const values = NODE_KINDS.map((kind) => CANVAS_NODE_KIND_GEOMETRY[kind]);
    expect(new Set(values).size).toBe(NODE_KINDS.length);
  });
});

describe("CANVAS_NODE_KIND_LABEL — polytoken's word per kind, in ONE place", () => {
  it("names every kind with a non-empty word", () => {
    for (const kind of NODE_KINDS) {
      expect(CANVAS_NODE_KIND_LABEL[kind], `${kind} label`).toMatch(/\S/);
    }
  });

  it("every label is distinct", () => {
    const values = NODE_KINDS.map((kind) => CANVAS_NODE_KIND_LABEL[kind]);
    expect(new Set(values).size).toBe(NODE_KINDS.length);
  });
});

describe("no value ANYWHERE in the module carries the retired node-type family", () => {
  it("scans every exported map", () => {
    const everything = [
      ...EDGE_TIERS.flatMap(edgeStrings),
      ...NODE_KINDS.map((kind) => CANVAS_NODE_KIND_GEOMETRY[kind]),
      ...NODE_KINDS.map((kind) => CANVAS_NODE_KIND_LABEL[kind]),
    ];
    for (const value of everything) {
      expect(value).not.toContain(RETIRED_NODE_TYPE_FAMILY);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 61-02-PLAN.md TASK 3 — THE EDGE-TIER x NODE-KIND MATRIX GATE.
 * The canvas's counterpart to 60-04's 20-case role x status gate.
 *
 * A NOTE ON SHAPE, stated so nobody later "harmonizes" it with the inbox's:
 * `inbox-structure.test.tsx` compares a colour-blind DOM fingerprint against a
 * frozen baseline, because its redesign is a RESTRUCTURE and DOM shape is the
 * honest evidence. This module is pure class COMPOSITION over closed maps —
 * its correctness genuinely lives in the vocabulary, not in DOM topology. So
 * the honest gate here is a semantic matrix over the maps. This file
 * deliberately does NOT import `fingerprintTree` and does not fabricate DOM to
 * make a shape gate applicable. (61-05 gates the rendered node shells; this
 * gate covers the vocabulary they resolve against.)
 * ════════════════════════════════════════════════════════════════════════ */

/** Which tier family, if any, a class string names. */
function familyIn(value: string): "conf" | "sugg" | null {
  const namesConf = value.includes("conf");
  const namesSugg = value.includes("sugg");
  if (namesConf && namesSugg) {
    throw new Error(`a single treatment names BOTH tier families: "${value}"`);
  }
  if (namesConf) return "conf";
  if (namesSugg) return "sugg";
  return null;
}

function classSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function symmetricDiff(a: Set<string>, b: Set<string>): string[] {
  return [
    ...Array.from(a).filter((cls) => !b.has(cls)),
    ...Array.from(b).filter((cls) => !a.has(cls)),
  ];
}

/** A tier token or a retired node-type token — the two things kind may never carry. */
const TIER_OR_RETIRED_TOKEN = new RegExp(`conf|sugg|${["gra", "ph"].join("")}-`);

describe("MATRIX: tier and kind are ORTHOGONAL across the full edge-tier x node-kind space", () => {
  for (const tier of EDGE_TIERS) {
    for (const kind of NODE_KINDS) {
      it(`edge=${tier} x kind=${kind}: the tier reading and the kind reading do not interfere`, () => {
        const { path } = CANVAS_EDGE_TIER[tier];
        const geometry = CANVAS_NODE_KIND_GEOMETRY[kind];
        const claim = EDGE_TIER_CLAIM[tier];

        // TIER IS COLOUR — and the expectation is DERIVED from the shared
        // facts, never restated. A test that hardcoded the same fact a third
        // time would be a third map.
        const expectedFamily = claim === null ? null : TIER_HUE_FAMILY[claim];
        const expectedDash = claim === null ? false : TIER_IS_DASHED[claim];
        expect(familyIn(path), `edge ${tier} family`).toBe(expectedFamily);
        expect(path.includes(DASH_IDIOM), `edge ${tier} dashedness`).toBe(expectedDash);

        // KIND IS NOT COLOUR — whatever the edge beside it is doing, the node's
        // kind contributes no tier reading of its own.
        expect(familyIn(geometry), `kind ${kind} must state no tier`).toBeNull();
        expect(geometry).not.toContain(RETIRED_NODE_TYPE_FAMILY);

        // ...and kind never spends the dash, which tier owns outright.
        expect(geometry).not.toContain("dashed");
      });
    }
  }
});

describe("KIND IS NOT COLOUR — the DIFFERENCE between any two kinds carries no hue (law 3)", () => {
  // The strongest available statement of law 3 on this surface: it is not
  // enough that no kind names a tier token — the thing that SEPARATES two
  // kinds must not be a colour. This is what catches a future edit that
  // reaches for a hue to tell two node kinds apart.
  for (let i = 0; i < NODE_KINDS.length; i++) {
    for (let j = i + 1; j < NODE_KINDS.length; j++) {
      const a = NODE_KINDS[i]!;
      const b = NODE_KINDS[j]!;
      it(`${a} vs ${b}: their set difference contains no tier or retired node-type token`, () => {
        const diff = symmetricDiff(
          classSet(CANVAS_NODE_KIND_GEOMETRY[a]),
          classSet(CANVAS_NODE_KIND_GEOMETRY[b]),
        );
        for (const cls of diff) {
          expect(
            cls,
            `kind-only class difference "${cls}" (between ${a} and ${b}) must not carry a tier/retired token`,
          ).not.toMatch(TIER_OR_RETIRED_TOKEN);
        }
      });
    }
  }
});

describe("KIND IS LEGIBLE — for a fixed tier, all five kinds stay distinguishable", () => {
  // The point is to RE-ENCODE kind, not delete it. This is the assertion that
  // would have caught Phase 59's collapse of the three role hues onto three
  // near-identical greys — the regression 60-04 was written to repair. The
  // canvas is one edit away from the same failure: its retired node-type
  // tokens already resolve to within 4.4% lightness of each other.
  for (const tier of EDGE_TIERS) {
    it(`edge=${tier}: every node kind (registered + unknown) renders distinguishably`, () => {
      // Tier lives on the EDGE and kind on the NODE, so a node's geometry is
      // the whole of its kind reading at any edge tier.
      const rendered = NODE_KINDS.map((kind) => CANVAS_NODE_KIND_GEOMETRY[kind]);
      expect(new Set(rendered).size, `distinct kind treatments at edge=${tier}`).toBe(
        NODE_KINDS.length,
      );
    });
  }

  it("no kind's geometry is empty — every kind makes a positive structural statement", () => {
    for (const kind of NODE_KINDS) {
      expect(CANVAS_NODE_KIND_GEOMETRY[kind], `${kind} geometry`).toMatch(/\S/);
    }
  });
});

describe("LAW 1 ON CHROME — the module names no selection/focus colour but ink", () => {
  const ALL_CLASS_VALUES = [
    ...EDGE_TIERS.flatMap(edgeStrings),
    ...NODE_KINDS.map((kind) => CANVAS_NODE_KIND_GEOMETRY[kind]),
  ];

  it("no exported value contains the retired node-type family", () => {
    for (const value of ALL_CLASS_VALUES) {
      expect(value).not.toContain(RETIRED_NODE_TYPE_FAMILY);
    }
  });

  it("any ring/outline token is ink — selected and focused states carry NO hue", () => {
    // 58-IDENTITY law 1: "Buttons, links, nav, selected states, focus rings ...
    // carry NO hue." Tier owns fill and stroke; it never owns selection.
    const RING_TOKEN_PATTERN = /\b(?:ring|outline)-([a-z][a-z0-9-]*)/g;
    for (const value of ALL_CLASS_VALUES) {
      for (const [, token] of value.matchAll(RING_TOKEN_PATTERN)) {
        expect(token, `selection/focus colour "${token}" must be ink`).toContain("ink");
      }
    }
  });
});

describe("AGREEMENT — two surfaces, one answer to what a tier looks like", () => {
  // The day the canvas and the email-detail view disagree about what
  // "confirmed" looks like is a RED TEST here, rather than a user noticing two
  // panels disagreeing. This compares the two surfaces' literals DIRECTLY:
  // asserting each against the shared facts separately would not catch a
  // surface that agreed with the facts in a different idiom.
  const SHARED_TIERS = ["confirmed", "suggested"] as const satisfies readonly Tier[];

  for (const tier of SHARED_TIERS) {
    it(`${tier}: the canvas edge and the region box name the SAME family`, () => {
      const canvasFamily = familyIn(CANVAS_EDGE_TIER[tier].path);
      const regionFamily = familyIn(REGION_TIER[tier].box);

      expect(canvasFamily, `canvas ${tier} family`).not.toBeNull();
      expect(canvasFamily, `canvas vs region disagree on ${tier}'s family`).toBe(regionFamily);
      // ...and both agree with the shared truth they were derived from.
      expect(canvasFamily, `${tier} vs TIER_HUE_FAMILY`).toBe(TIER_HUE_FAMILY[tier]);
    });

    it(`${tier}: the canvas edge and the region box agree on solid-vs-dashed`, () => {
      // Each surface spells the fact in its own idiom — a CSS box says
      // `border-dashed`, an SVG path says `stroke-dasharray`. The BOOLEAN is
      // what has to match, which is exactly why the shared module holds the
      // fact and not the class.
      const canvasDashed = CANVAS_EDGE_TIER[tier].path.includes(DASH_IDIOM);
      const regionDashed = REGION_TIER[tier].box.includes("border-dashed");

      expect(canvasDashed, `canvas vs region disagree on ${tier}'s dashedness`).toBe(regionDashed);
      expect(canvasDashed, `${tier} vs TIER_IS_DASHED`).toBe(TIER_IS_DASHED[tier]);
    });
  }

  it("the canvas states no tier the shared truth does not know", () => {
    for (const tier of EDGE_TIERS) {
      const claim = EDGE_TIER_CLAIM[tier];
      if (claim === null) continue;
      expect(Object.hasOwn(TIER_HUE_FAMILY, claim), `${claim} is a known Tier`).toBe(true);
    }
  });
});
