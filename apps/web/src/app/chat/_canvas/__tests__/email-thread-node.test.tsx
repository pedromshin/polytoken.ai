/**
 * email-thread-node.test.tsx — EmailThreadNode (CLUS-01, 54-UI-SPEC.md
 * Component 1): the versioned-registry `email-thread` node type
 * (node.data schema/registry/dimensions — Task 1). Task 2 extends this SAME
 * file with the component's loading/error/empty/success branches,
 * Attach-chat mutation flow, and remove wiring (TDD RED->GREEN).
 *
 * "registry" describe block mirrors node-type-registry.test.ts's own
 * hash-flip/schema-strict conventions — kept here (rather than that file)
 * per 54-04-PLAN.md Task 1's own verify command
 * (`npx vitest run .../email-thread-node.test.tsx -t "registry"`).
 */

import { describe, expect, it } from "vitest";

import {
  computeNodeRegistryHash,
  NODE_REGISTRY_VERSION,
} from "../node-registry-version";
import { EmailThreadNodeDataSchema } from "../node-data-schemas";
import { NODE_TYPE_REGISTRY } from "../node-type-registry";
import type { NodeTypeRegistryEntry } from "../node-type-registry";
import { CANVAS_NODE_DIMENSIONS } from "../canvas-layout";

const VALID_THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("registry", () => {
  describe("EmailThreadNodeDataSchema", () => {
    it("accepts a valid threadId with no label", () => {
      expect(
        EmailThreadNodeDataSchema.safeParse({ threadId: VALID_THREAD_ID }).success,
      ).toBe(true);
    });

    it("accepts a valid threadId with a label", () => {
      expect(
        EmailThreadNodeDataSchema.safeParse({
          threadId: VALID_THREAD_ID,
          label: "Q3 renewal thread",
        }).success,
      ).toBe(true);
    });

    it("rejects a non-uuid threadId", () => {
      expect(
        EmailThreadNodeDataSchema.safeParse({ threadId: "not-a-uuid" }).success,
      ).toBe(false);
    });

    it("rejects a label longer than 120 characters", () => {
      expect(
        EmailThreadNodeDataSchema.safeParse({
          threadId: VALID_THREAD_ID,
          label: "a".repeat(121),
        }).success,
      ).toBe(false);
    });

    it("rejects an unrecognized extra top-level key (.strict())", () => {
      expect(
        EmailThreadNodeDataSchema.safeParse({
          threadId: VALID_THREAD_ID,
          extra: true,
        }).success,
      ).toBe(false);
    });
  });

  describe("NODE_TYPE_REGISTRY['email-thread']", () => {
    it("exists with dataSchema === EmailThreadNodeDataSchema", () => {
      expect(NODE_TYPE_REGISTRY["email-thread"]).toBeDefined();
      expect(NODE_TYPE_REGISTRY["email-thread"]?.dataSchema).toBe(
        EmailThreadNodeDataSchema,
      );
      expect(NODE_TYPE_REGISTRY["email-thread"]?.id).toBe("email-thread");
    });
  });

  describe("computeNodeRegistryHash", () => {
    it("flips when the email-thread entry is added vs a registry without it", () => {
      const withoutEmailThread: Record<string, NodeTypeRegistryEntry> = {
        ...NODE_TYPE_REGISTRY,
      };
      delete withoutEmailThread["email-thread"];

      expect(computeNodeRegistryHash(withoutEmailThread)).not.toBe(
        computeNodeRegistryHash(NODE_TYPE_REGISTRY),
      );
    });

    it("NODE_REGISTRY_VERSION reflects the CURRENT registry (incl. email-thread)", () => {
      expect(NODE_REGISTRY_VERSION).toBe(computeNodeRegistryHash(NODE_TYPE_REGISTRY));
    });
  });

  describe("CANVAS_NODE_DIMENSIONS['email-thread']", () => {
    it("is fixed 320x220", () => {
      expect(CANVAS_NODE_DIMENSIONS["email-thread"]).toEqual({
        width: 320,
        height: 220,
      });
    });
  });
});
