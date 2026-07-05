/**
 * edge-payload-schema.test.ts — unit tests for EdgePayloadSchema, the Zod
 * boundary a data-carrying edge's { sourcePath, targetKey } payload must
 * cross before an edge is created or updated (STATE-02, FOUND-6, T-23-11).
 */

import { describe, expect, it } from "vitest";

import { EdgePayloadSchema } from "../edge-payload-schema";

describe("EdgePayloadSchema", () => {
  it("accepts a valid { sourcePath, targetKey } payload", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.abc.value",
      targetKey: "label",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a shared.* sourcePath", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "shared.theme",
      targetKey: "themeName",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty sourcePath", () => {
    const result = EdgePayloadSchema.safeParse({ sourcePath: "", targetKey: "label" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty targetKey", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.abc.value",
      targetKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a sourcePath containing a __proto__ segment", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.__proto__.value",
      targetKey: "label",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a sourcePath containing a constructor segment", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.abc.constructor",
      targetKey: "label",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a targetKey that IS a prototype segment", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.abc.value",
      targetKey: "prototype",
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra unrecognized keys (.strict())", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "panels.abc.value",
      targetKey: "label",
      extra: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string sourcePath/targetKey", () => {
    expect(EdgePayloadSchema.safeParse({ sourcePath: 1, targetKey: "label" }).success).toBe(
      false,
    );
    expect(
      EdgePayloadSchema.safeParse({ sourcePath: "panels.abc.value", targetKey: null }).success,
    ).toBe(false);
  });

  it("produces exactly the two-key shape 23-01's CanvasSnapshotSchema edge.data expects", () => {
    const result = EdgePayloadSchema.safeParse({
      sourcePath: "shared.theme",
      targetKey: "themeName",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(["sourcePath", "targetKey"]);
    }
  });
});
