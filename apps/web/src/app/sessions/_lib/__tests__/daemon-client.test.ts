/**
 * Protocol frame encode/decode against the FROZEN daemon protocol — not a mock of it.
 *
 * Round-trips go through @polytoken/daemon-protocol's own `parseClientFrame` /
 * `parseDaemonFrame`, so a drift between this client and the frozen schemas fails here,
 * in jsdom, before any daemon exists.
 */
import { parseClientFrame } from "@polytoken/daemon-protocol";
import { describe, expect, it } from "vitest";

import {
  DAEMON_DEFAULT_PORT,
  buildDaemonUrl,
  decodeDaemonFrame,
  encodeClientFrame,
  newEnvelopeId,
} from "../daemon-client";

describe("encodeClientFrame", () => {
  it("produces frames the daemon-side parser accepts (session.attach)", () => {
    const frame = encodeClientFrame("session.attach", { sessionId: "s-1", sinceSeq: 41 });
    const parsed = parseClientFrame(JSON.parse(frame.text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.type).toBe("session.attach");
    expect(parsed.envelope.id).toBe(frame.id);
    expect(parsed.payload).toEqual({ sessionId: "s-1", sinceSeq: 41 });
  });

  it("produces valid session.list, session.start and session.input frames", () => {
    const list = parseClientFrame(JSON.parse(encodeClientFrame("session.list", {}).text));
    expect(list.ok).toBe(true);

    const start = parseClientFrame(
      JSON.parse(encodeClientFrame("session.start", { cwd: "/home/u/p", cmd: "bash" }).text),
    );
    expect(start.ok).toBe(true);

    const input = parseClientFrame(
      JSON.parse(encodeClientFrame("session.input", { sessionId: "s-1", data: "ls\n" }).text),
    );
    expect(input.ok).toBe(true);
  });

  it("honors a caller-supplied envelope id for correlation (R-01)", () => {
    const frame = encodeClientFrame("session.list", {}, "my-id-1");
    expect(frame.id).toBe("my-id-1");
    expect((JSON.parse(frame.text) as { id: string }).id).toBe("my-id-1");
  });

  it("generates unique envelope ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEnvelopeId()));
    expect(ids.size).toBe(50);
  });
});

describe("decodeDaemonFrame", () => {
  it("accepts a valid session.output frame", () => {
    const raw = JSON.stringify({
      id: "e-1",
      type: "session.output",
      payload: { sessionId: "s-1", seq: 0, data: "hello\n" },
    });
    const frame = decodeDaemonFrame(raw);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    expect(frame.type).toBe("session.output");
    expect(frame.payload).toEqual({ sessionId: "s-1", seq: 0, data: "hello\n" });
  });

  it("rejects non-JSON without throwing (R-02)", () => {
    const frame = decodeDaemonFrame("not json {");
    expect(frame.ok).toBe(false);
    if (frame.ok) return;
    expect(frame.error).toContain("not valid JSON");
  });

  it("rejects a client-only type arriving from the daemon (direction map)", () => {
    const raw = JSON.stringify({
      id: "e-2",
      type: "session.input",
      payload: { sessionId: "s-1", data: "x" },
    });
    const frame = decodeDaemonFrame(raw);
    expect(frame.ok).toBe(false);
    if (frame.ok) return;
    expect(frame.error).toContain("not legal");
  });

  it("rejects a payload that fails the frozen schema", () => {
    const raw = JSON.stringify({
      id: "e-3",
      type: "session.output",
      payload: { sessionId: "s-1", seq: -1, data: "x" }, // seq must be >= 0
    });
    expect(decodeDaemonFrame(raw).ok).toBe(false);
  });
});

describe("buildDaemonUrl", () => {
  it("targets loopback with the token as a query parameter (browser auth seam)", () => {
    const url = buildDaemonUrl({ token: "abc def", port: DAEMON_DEFAULT_PORT });
    expect(url).toBe("ws://127.0.0.1:8787/?token=abc%20def");
  });

  it("respects a custom port", () => {
    expect(buildDaemonUrl({ token: "t", port: 9001 })).toContain(":9001/");
  });
});
