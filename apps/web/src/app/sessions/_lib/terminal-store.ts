/**
 * The attached-terminal state machine — a pure reducer, jsdom-testable.
 *
 * Everything about "what the terminal knows" lives here as data; the WS hook
 * (`_hooks/use-daemon-session.ts`) only translates socket events into `TerminalEvent`s and
 * the component only renders `TerminalState`. Honest states are the point: `disconnected`
 * and `exited` are first-class phases, not error strings bolted on.
 *
 * ## Sequence reassembly
 *
 * `session.output` is ordered by `seq` (daemon→client, contract comment "ordered"), but a
 * reconnect with `sinceSeq` can replay frames we already hold. The reducer therefore:
 *   - ignores any `seq < nextSeq` (duplicate replay),
 *   - appends `seq === nextSeq` immediately,
 *   - buffers `seq > nextSeq` and drains the buffer as gaps fill.
 * Scrollback survives disconnects — a dropped socket keeps the transcript and resumes from
 * `sinceSeqForResume(state)`.
 */
import type { SessionMeta } from "@polytoken/daemon-protocol";

export type TerminalPhase =
  /** No connection attempt yet (e.g. no token configured). */
  | "idle"
  /** WebSocket dialing 127.0.0.1. */
  | "connecting"
  /** Socket open, `session.attach` sent, ack not yet received. */
  | "attaching"
  /** Attached and streaming. */
  | "live"
  /** The session's process ended (`session.exit`); scrollback stays readable. */
  | "exited"
  /** The socket dropped (daemon gone, token rejected, network) — reconnect offered. */
  | "disconnected";

export type TerminalState = {
  readonly phase: TerminalPhase;
  /** From `session.list` on the same socket — the attach ack carries no meta. */
  readonly meta: SessionMeta | null;
  /** Raw reassembled pty output (ANSI still embedded — see renderScrollback). */
  readonly scrollback: string;
  /** The next seq we will append; everything below it is already in scrollback. */
  readonly nextSeq: number;
  /** Out-of-order frames waiting for their gap to fill, keyed by seq. */
  readonly pending: Readonly<Record<number, string>>;
  readonly exitCode: number | null;
  /** Human-readable failure detail for the current phase, when there is one. */
  readonly error: string | null;
};

export type TerminalEvent =
  | { readonly kind: "connect" }
  | { readonly kind: "socket-open" }
  | { readonly kind: "attach-ack"; readonly lastSeq: number }
  | { readonly kind: "meta"; readonly meta: SessionMeta }
  | { readonly kind: "output"; readonly seq: number; readonly data: string }
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "socket-closed"; readonly detail: string | null }
  | { readonly kind: "protocol-error"; readonly message: string };

/** Keep roughly this much transcript; older output is trimmed from the front. */
export const MAX_SCROLLBACK_CHARS = 200_000;

export const initialTerminalState: TerminalState = {
  phase: "idle",
  meta: null,
  scrollback: "",
  nextSeq: 0,
  pending: {},
  exitCode: null,
  error: null,
};

/** Trim from the front, preferring a newline boundary so the top line isn't torn. */
function capScrollback(text: string): string {
  if (text.length <= MAX_SCROLLBACK_CHARS) return text;
  const overflow = text.length - MAX_SCROLLBACK_CHARS;
  const newlineAfterOverflow = text.indexOf("\n", overflow);
  const cutAt =
    newlineAfterOverflow !== -1 && newlineAfterOverflow - overflow < 2_000
      ? newlineAfterOverflow + 1
      : overflow;
  return text.slice(cutAt);
}

function applyOutput(state: TerminalState, seq: number, data: string): TerminalState {
  if (seq < state.nextSeq) return state; // duplicate replay after a resume
  if (state.pending[seq] !== undefined && seq !== state.nextSeq) return state;

  const pending: Record<number, string> = { ...state.pending, [seq]: data };
  const chunks: string[] = [];
  let next = state.nextSeq;
  while (pending[next] !== undefined) {
    chunks.push(pending[next]);
    delete pending[next];
    next += 1;
  }
  if (chunks.length === 0) return { ...state, pending };

  return {
    ...state,
    pending,
    nextSeq: next,
    scrollback: capScrollback(state.scrollback + chunks.join("")),
  };
}

export function terminalReducer(state: TerminalState, event: TerminalEvent): TerminalState {
  switch (event.kind) {
    case "connect":
      // Scrollback and nextSeq survive: a reconnect resumes, it does not restart.
      return { ...state, phase: "connecting", error: null };
    case "socket-open":
      return { ...state, phase: "attaching" };
    case "attach-ack":
      // An exited session can still be attached for its transcript; stay honest about it.
      return state.phase === "exited" ? state : { ...state, phase: "live" };
    case "meta":
      return { ...state, meta: event.meta };
    case "output":
      return applyOutput(state, event.seq, event.data);
    case "exit":
      return { ...state, phase: "exited", exitCode: event.code };
    case "socket-closed":
      // An exit already explains itself — a close afterwards is expected, not a failure.
      if (state.phase === "exited") return state;
      return { ...state, phase: "disconnected", error: event.detail };
    case "protocol-error":
      // R-02 posture: a bad frame is logged state, never a killed stream.
      return { ...state, error: event.message };
  }
}

/**
 * The `sinceSeq` to present on (re)attach: the last seq already in scrollback, or
 * undefined for a fresh attach (full replay). Overlap is safe — the reducer drops
 * duplicates — so "last processed" is the conservative reading of the resume contract.
 */
export function sinceSeqForResume(state: TerminalState): number | undefined {
  return state.nextSeq > 0 ? state.nextSeq - 1 : undefined;
}

// ---------------------------------------------------------------------------
// Display transforms (pure; used by the component at render time)
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape sequences (CSI, OSC, and single-char escapes). The taste ruling allows
 * genuine ANSI colour inside the pty viewport, but rendering it faithfully needs a real
 * ANSI-to-spans pass — deferred as a seam. Until then we show honest plain text rather
 * than raw escape bytes.
 */
const ANSI_PATTERN = new RegExp(
  [
    "\\u001B\\[[0-9;?]*[ -/]*[@-~]", // CSI … final byte
    "\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", // OSC … BEL or ST
    "\\u001B[@-_]", // other single ESC sequences
  ].join("|"),
  "g",
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Render raw pty output as plain text: strip ANSI, then resolve carriage-return rewrites
 * per line (progress bars redraw with `\r`; the final draw is what the user should read).
 */
export function renderScrollback(raw: string): string {
  const stripped = stripAnsi(raw).replace(/\r\n/g, "\n");
  return stripped
    .split("\n")
    .map((line) => {
      const lastCr = line.lastIndexOf("\r");
      return lastCr === -1 ? line : line.slice(lastCr + 1);
    })
    .join("\n");
}
