/**
 * The terminal state machine, exercised as pure data — every honest state the surface
 * renders (connecting, live, exited, disconnected) plus the seq-reassembly rules the
 * resume contract (R-11 sinceSeq) depends on.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SCROLLBACK_CHARS,
  initialTerminalState,
  renderScrollback,
  sinceSeqForResume,
  stripAnsi,
  terminalReducer,
  type TerminalEvent,
  type TerminalState,
} from "../terminal-store";

function run(events: readonly TerminalEvent[], from: TerminalState = initialTerminalState) {
  return events.reduce(terminalReducer, from);
}

const CONNECT_AND_ATTACH: readonly TerminalEvent[] = [
  { kind: "connect" },
  { kind: "socket-open" },
  { kind: "attach-ack", lastSeq: -1 },
];

describe("connection lifecycle", () => {
  it("walks idle → connecting → attaching → live", () => {
    expect(initialTerminalState.phase).toBe("idle");
    expect(run([{ kind: "connect" }]).phase).toBe("connecting");
    expect(run([{ kind: "connect" }, { kind: "socket-open" }]).phase).toBe("attaching");
    expect(run([...CONNECT_AND_ATTACH]).phase).toBe("live");
  });

  it("a dropped socket is an honest disconnected state that keeps the transcript", () => {
    const live = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 0, data: "hello\n" },
      { kind: "socket-closed", detail: "going away" },
    ]);
    expect(live.phase).toBe("disconnected");
    expect(live.error).toBe("going away");
    expect(live.scrollback).toBe("hello\n");
    expect(live.nextSeq).toBe(1);
  });

  it("reconnect resumes: scrollback and nextSeq survive connect, replays are deduped", () => {
    const dropped = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 0, data: "a" },
      { kind: "output", seq: 1, data: "b" },
      { kind: "socket-closed", detail: null },
    ]);
    expect(sinceSeqForResume(dropped)).toBe(1);

    const resumed = run(
      [
        { kind: "connect" },
        { kind: "socket-open" },
        { kind: "attach-ack", lastSeq: 2 },
        { kind: "output", seq: 1, data: "b" }, // replayed — must not duplicate
        { kind: "output", seq: 2, data: "c" },
      ],
      dropped,
    );
    expect(resumed.phase).toBe("live");
    expect(resumed.scrollback).toBe("abc");
    expect(resumed.nextSeq).toBe(3);
  });

  it("a fresh attach presents no sinceSeq", () => {
    expect(sinceSeqForResume(initialTerminalState)).toBeUndefined();
  });

  it("exit is terminal-honest: exited phase + code, and a later close stays exited", () => {
    const state = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 0, data: "done\n" },
      { kind: "exit", code: 1 },
      { kind: "socket-closed", detail: null },
    ]);
    expect(state.phase).toBe("exited");
    expect(state.exitCode).toBe(1);
    expect(state.scrollback).toBe("done\n");
  });

  it("a protocol error records the message without killing the stream (R-02 posture)", () => {
    const state = run([
      ...CONNECT_AND_ATTACH,
      { kind: "protocol-error", message: "invalid session.output payload" },
      { kind: "output", seq: 0, data: "still here" },
    ]);
    expect(state.phase).toBe("live");
    expect(state.error).toBe("invalid session.output payload");
    expect(state.scrollback).toBe("still here");
  });
});

describe("seq reassembly", () => {
  it("buffers out-of-order output and drains when the gap fills", () => {
    const state = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 2, data: "C" },
      { kind: "output", seq: 0, data: "A" },
    ]);
    expect(state.scrollback).toBe("A");
    expect(state.pending[2]).toBe("C");

    const drained = terminalReducer(state, { kind: "output", seq: 1, data: "B" });
    expect(drained.scrollback).toBe("ABC");
    expect(drained.nextSeq).toBe(3);
    expect(Object.keys(drained.pending)).toHaveLength(0);
  });

  it("ignores duplicates below nextSeq", () => {
    const state = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 0, data: "A" },
      { kind: "output", seq: 0, data: "A" },
    ]);
    expect(state.scrollback).toBe("A");
    expect(state.nextSeq).toBe(1);
  });

  it("caps scrollback, trimming from the front", () => {
    const big = "x".repeat(MAX_SCROLLBACK_CHARS - 10) + "\n";
    const state = run([
      ...CONNECT_AND_ATTACH,
      { kind: "output", seq: 0, data: big },
      { kind: "output", seq: 1, data: "TAIL-".repeat(10) },
    ]);
    expect(state.scrollback.length).toBeLessThanOrEqual(MAX_SCROLLBACK_CHARS);
    expect(state.scrollback.endsWith("TAIL-")).toBe(true);
  });
});

describe("display transforms", () => {
  it("stripAnsi removes CSI colour/cursor sequences and OSC titles", () => {
    expect(stripAnsi("\u001B[32mok\u001B[0m")).toBe("ok");
    expect(stripAnsi("\u001B]0;title\u0007text")).toBe("text");
    expect(stripAnsi("\u001B[2K\u001B[1Gline")).toBe("line");
  });

  it("renderScrollback resolves carriage-return progress rewrites to the final draw", () => {
    expect(renderScrollback("progress 10%\rprogress 50%\rprogress 100%\ndone\n")).toBe(
      "progress 100%\ndone\n",
    );
  });

  it("renderScrollback normalizes CRLF", () => {
    expect(renderScrollback("a\r\nb\r\n")).toBe("a\nb\n");
  });
});
