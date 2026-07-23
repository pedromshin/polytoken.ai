/**
 * projection-canvas-sync.test.ts — the LIVE half of the AI-02 canvas-face gate.
 *
 * `@polytoken/api-client`'s projection map declares each capability's canvas node face against
 * CANVAS_NODE_TYPE_IDS — a hand-mirrored copy of NODE_TYPE_REGISTRY's keys, because api-client
 * may never import apps/web (the dependency points the other way). This test is the promised
 * drift alarm: it imports BOTH sides and fails on divergence in EITHER direction, so the mirror
 * can never quietly rot the way an uncrosschecked copy would.
 *
 * (The manifest-side half of the gate — declaration bijection, face resolution, explicit
 * exceptions — lives in packages/api-client/src/router/capabilities/__tests__/projection-map.test.ts.)
 */
import { describe, expect, it } from "vitest";

import {
  CANVAS_NODE_TYPE_IDS,
  CAPABILITY_PROJECTIONS,
} from "@polytoken/api-client/capability-projections";

import {
  NODE_TYPE_REGISTRY,
  resolveNodeType,
} from "~/app/chat/_canvas/node-type-registry";

describe("capability projection map ↔ canvas NODE_TYPE_REGISTRY", () => {
  it("the api-client mirror equals the live registry's key set (drift alarm, both directions)", () => {
    expect([...CANVAS_NODE_TYPE_IDS].sort()).toEqual(Object.keys(NODE_TYPE_REGISTRY).sort());
  });

  it("every capability's wired canvas face resolves to a registered node type", () => {
    for (const projection of CAPABILITY_PROJECTIONS) {
      if (projection.canvas.status === "exception") continue;
      const resolved = resolveNodeType(projection.canvas.nodeType);
      expect(
        resolved.kind,
        `"${projection.id}" declares canvas node "${projection.canvas.nodeType}" but the canvas does not register it`,
      ).toBe("registered");
    }
  });
});
