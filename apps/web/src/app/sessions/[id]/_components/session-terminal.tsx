"use client";

/**
 * /sessions/[id] — the attached terminal, xterm-free.
 *
 * Taste contract (taste-terminal.md, taste-references.md §3):
 *  - the scrollback is part of the paper: `--bright` sheet, generous internal padding and
 *    1.55 line-height — never a black rectangle punched into a card (anti-generic tell 6);
 *  - the input is a sunken well (`--shade`, `--rule` top border), visually distinct from
 *    the historical stream (pattern 6);
 *  - auto-scroll never fights the reader: scrolling up suspends it and a
 *    "N new lines · jump to now" pill (bright/rule/ink — no hue) offers resync (pattern 9);
 *  - exit state is words in a rule-bordered chip ("exit 1"), never a red fill (pattern 5);
 *  - disconnected is an honest first-class state with a user-driven reconnect.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@polytoken/ui/button";

import { useDaemonSession } from "../../_hooks/use-daemon-session";
import { renderScrollback } from "../../_lib/terminal-store";
import { DaemonConnectPanel } from "../../_components/daemon-connect-panel";
import { SessionGlyph, StateChip } from "../../_components/session-status";

const NEAR_BOTTOM_PX = 32;

function countLines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return count;
}

export function SessionTerminal({
  sessionId,
}: {
  readonly sessionId: string;
}): React.ReactElement {
  const { state, config, sendInput, reconnect } = useDaemonSession(sessionId);
  const [draft, setDraft] = useState("");

  const text = useMemo(() => renderScrollback(state.scrollback), [state.scrollback]);

  // -- auto-scroll bookkeeping (pattern 9) ----------------------------------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true); // reader is at (or near) the bottom
  const [newLines, setNewLines] = useState(0);
  const lastLineCountRef = useRef(0);

  useEffect(() => {
    const lines = countLines(text);
    const added = Math.max(0, lines - lastLineCountRef.current);
    lastLineCountRef.current = lines;

    const el = scrollRef.current;
    if (el === null) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      setNewLines(0);
    } else if (added > 0) {
      setNewLines((n) => n + added);
    }
  }, [text]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    pinnedRef.current = atBottom;
    if (atBottom) setNewLines(0);
  };

  const jumpToNow = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
    setNewLines(0);
  };

  // -- header state ---------------------------------------------------------
  const phaseChip = (() => {
    switch (state.phase) {
      case "live":
        return <StateChip>live</StateChip>;
      case "connecting":
      case "attaching":
        return <StateChip muted>connecting…</StateChip>;
      case "exited":
        return <StateChip>exit {state.exitCode ?? "?"}</StateChip>;
      case "disconnected":
        return <StateChip muted>disconnected</StateChip>;
      case "idle":
        return null;
    }
  })();

  if (config.loaded && config.token === null) {
    return (
      <div className="flex h-full flex-col">
        <TerminalHeader sessionId={sessionId} phaseChip={null} cmd={null} cwd={null} alive={false} streaming={false} />
        <DaemonConnectPanel config={config} unreachable={false} onRetry={reconnect} />
      </div>
    );
  }

  const disconnected = state.phase === "disconnected";
  const canType = state.phase === "live";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalHeader
        sessionId={sessionId}
        phaseChip={phaseChip}
        cmd={state.meta?.cmd ?? null}
        cwd={state.meta?.cwd ?? null}
        alive={state.phase === "live"}
        streaming={state.phase === "live"}
      />

      {disconnected ? (
        <div className="flex items-center gap-3 border-b border-rule bg-leaf px-panel py-2">
          <span className="text-sm text-ink">
            Connection to the daemon dropped
            {state.error !== null ? <span className="text-pencil"> — {state.error}</span> : null}
            .
          </span>
          <Button variant="outline" size="sm" onClick={reconnect}>
            Reconnect
          </Button>
        </div>
      ) : null}

      {/* The scrollback sheet — part of the paper, never a punched-out hole. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto bg-bright"
          role="log"
          aria-label="Terminal output"
        >
          {text.length === 0 ? (
            <p className="px-4 py-3 font-mono text-sm leading-[1.55] text-pencil">
              {state.phase === "live"
                ? "Attached — no output yet."
                : state.phase === "connecting" || state.phase === "attaching"
                  ? "Attaching…"
                  : "No output captured."}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm leading-[1.55] text-ink">
              {text}
            </pre>
          )}
        </div>

        {newLines > 0 ? (
          <button
            type="button"
            onClick={jumpToNow}
            className="absolute bottom-3 right-4 rounded-full border border-rule bg-bright px-3 py-1 text-xs text-ink transition-colors hover:bg-shade"
          >
            {newLines} new line{newLines === 1 ? "" : "s"} · jump to now
          </button>
        ) : null}
      </div>

      {/* The sunken input well — distinct from the historical stream. */}
      <div className="border-t border-rule bg-shade px-3 py-2">
        {state.phase === "exited" ? (
          <p className="font-mono text-xs text-pencil">
            session ended · exit {state.exitCode ?? "?"}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <span aria-hidden className="font-mono text-sm text-pencil">
              ›
            </span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendInput(`${draft}\n`);
                  setDraft("");
                  return;
                }
                // Ctrl-C with nothing typed interrupts the foreground process.
                if (event.ctrlKey && event.key === "c" && draft.length === 0) {
                  event.preventDefault();
                  sendInput("\u0003");
                }
              }}
              disabled={!canType}
              placeholder={
                canType ? "Type a command — Enter sends it" : "Not attached — input is paused"
              }
              aria-label="Terminal input"
              className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-pencil disabled:cursor-not-allowed"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalHeader({
  sessionId,
  phaseChip,
  cmd,
  cwd,
  alive,
  streaming,
}: {
  readonly sessionId: string;
  readonly phaseChip: React.ReactNode;
  readonly cmd: string | null;
  readonly cwd: string | null;
  readonly alive: boolean;
  readonly streaming: boolean;
}): React.ReactElement {
  return (
    <header className="flex items-center gap-3 border-b border-hair px-panel py-3">
      <Link
        href="/sessions"
        className="shrink-0 text-sm text-faded underline-offset-2 hover:text-ink hover:underline"
      >
        ← Sessions
      </Link>
      <SessionGlyph alive={alive} streaming={streaming} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm text-ink">
          {cmd !== null && cmd.length > 0 ? cmd : sessionId}
        </span>
        {cwd !== null ? (
          <span className="block truncate text-xs text-pencil">{cwd}</span>
        ) : null}
      </span>
      {phaseChip}
    </header>
  );
}
