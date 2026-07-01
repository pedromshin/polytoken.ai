import { describe, expect, it } from "vitest";

import {
  isTrustedIslandMessage,
  parseIslandMessage,
  type IslandMessage,
} from "./island-message";

describe("parseIslandMessage", () => {
  it("parses a valid ready message", () => {
    expect(parseIslandMessage({ type: "island-ready", nonce: "n1" })).toEqual({
      type: "island-ready",
      nonce: "n1",
    });
  });

  it("parses a runtime-error message", () => {
    const msg = parseIslandMessage({
      type: "island-runtime-error",
      nonce: "n1",
      source: "onerror",
      message: "boom",
    });
    expect(msg?.type).toBe("island-runtime-error");
  });

  it("rejects unknown types and malformed payloads", () => {
    expect(parseIslandMessage({ type: "evil", nonce: "n1" })).toBeNull();
    expect(parseIslandMessage({ type: "island-ready" })).toBeNull();
    expect(parseIslandMessage("not-an-object")).toBeNull();
    expect(parseIslandMessage(null)).toBeNull();
  });
});

describe("isTrustedIslandMessage — source identity + null origin + nonce", () => {
  const frameWindow = { id: "frame" };
  const msg: IslandMessage = { type: "island-ready", nonce: "good" };

  it("trusts only the matching source, null origin, and nonce", () => {
    expect(isTrustedIslandMessage({ source: frameWindow, origin: "null" }, frameWindow, "good", msg)).toBe(true);
  });

  it("rejects a wrong source window", () => {
    expect(isTrustedIslandMessage({ source: { id: "other" }, origin: "null" }, frameWindow, "good", msg)).toBe(false);
  });

  it("rejects a non-null origin (would indicate same-origin leak)", () => {
    expect(isTrustedIslandMessage({ source: frameWindow, origin: "https://host" }, frameWindow, "good", msg)).toBe(false);
  });

  it("rejects a nonce mismatch (replay)", () => {
    expect(isTrustedIslandMessage({ source: frameWindow, origin: "null" }, frameWindow, "expected", msg)).toBe(false);
  });
});
