"use client";

/**
 * /sessions — the daemon session registry.
 *
 * Taste contract (taste-references.md §3 "/sessions terminal"):
 *  - fuzzy-filterable list with a state glyph per row (pattern 3/5) — glyph + ink weight,
 *    never hue; the filter is a type-ahead input, not a modal;
 *  - the row IS the attach action (primary action ≤1 click from arrival);
 *  - connected-but-empty teaches ONE action: start a session (sunken well form);
 *  - no daemon teaches what the daemon is and how to start it (DaemonConnectPanel).
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";

import { useDaemonSessionList } from "../_hooks/use-daemon-session-list";
import { DaemonConnectPanel } from "./daemon-connect-panel";
import { SessionGlyph, StateChip } from "./session-status";

import type { SessionMeta } from "@polytoken/daemon-protocol";

function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionRow({ session }: { readonly session: SessionMeta }): React.ReactElement {
  return (
    <li>
      <Link
        href={`/sessions/${encodeURIComponent(session.sessionId)}`}
        className="flex items-center gap-3 px-row-x py-row-y transition-colors hover:bg-shade focus-visible:bg-shade focus-visible:outline-none"
      >
        <SessionGlyph alive={session.alive} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm text-ink">
            {session.cmd.length > 0 ? session.cmd : "(default shell)"}
          </span>
          <span className="block truncate text-xs text-pencil">{session.cwd}</span>
        </span>
        <StateChip muted={!session.alive}>{session.alive ? "running" : "ended"}</StateChip>
        <time className="tabular text-2xs text-pencil" dateTime={session.startedAt}>
          {formatStartedAt(session.startedAt)}
        </time>
      </Link>
    </li>
  );
}

/** The sunken start well — `--shade` ground, rule border (taste pattern 6 adapted). */
function StartSessionWell({
  onStart,
  prominent,
}: {
  readonly onStart: (cwd: string) => void;
  readonly prominent: boolean;
}): React.ReactElement {
  const [cwd, setCwd] = useState("");
  return (
    <form
      className="flex items-center gap-2 rounded-md border border-rule bg-shade p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = cwd.trim();
        if (trimmed.length === 0) return;
        onStart(trimmed);
        setCwd("");
      }}
    >
      <Input
        value={cwd}
        onChange={(event) => setCwd(event.target.value)}
        placeholder="Working directory, e.g. /home/you/projects/app"
        aria-label="Working directory for the new session"
        autoFocus={prominent}
        className="border-0 bg-bright font-mono text-xs shadow-none"
      />
      <Button type="submit" size="sm" disabled={cwd.trim().length === 0}>
        Start session
      </Button>
    </form>
  );
}

export function SessionsList(): React.ReactElement {
  const router = useRouter();
  const list = useDaemonSessionList((meta) => {
    router.push(`/sessions/${encodeURIComponent(meta.sessionId)}`);
  });
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return list.sessions;
    return list.sessions.filter(
      (s) =>
        s.cmd.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle),
    );
  }, [list.sessions, filter]);

  const connectionChip = (() => {
    switch (list.phase) {
      case "connected":
        return <StateChip>daemon connected</StateChip>;
      case "connecting":
        return <StateChip muted>connecting…</StateChip>;
      case "unreachable":
        return <StateChip muted>no daemon</StateChip>;
      case "idle":
        return null;
    }
  })();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-hair px-panel py-3">
        <h1 className="text-lg font-semibold text-ink">Sessions</h1>
        {connectionChip}
      </header>

      {!list.config.loaded ? null : list.config.token === null ? (
        <DaemonConnectPanel config={list.config} unreachable={false} onRetry={list.reconnect} />
      ) : list.phase === "unreachable" ? (
        <DaemonConnectPanel config={list.config} unreachable onRetry={list.reconnect} />
      ) : list.phase !== "connected" ? (
        <p className="p-panel text-sm text-pencil" aria-live="polite">
          Reaching the daemon at 127.0.0.1:{list.config.port}…
        </p>
      ) : list.sessions.length === 0 ? (
        <section className="mx-auto w-full max-w-2xl p-panel">
          <div className="rounded-md border border-rule bg-leaf p-panel">
            <h2 className="text-base font-semibold text-ink">No sessions yet</h2>
            <p className="mt-1 text-sm text-faded">
              Start one — give it a working directory inside the daemon&apos;s configured
              roots.
            </p>
            <div className="mt-3">
              <StartSessionWell onStart={list.startSession} prominent />
            </div>
          </div>
        </section>
      ) : (
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-panel">
          <div className="flex items-center gap-2">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by command or directory…"
              aria-label="Filter sessions"
              className="max-w-sm"
            />
            <span className="tabular text-xs text-pencil">
              {filtered.length}/{list.sessions.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-pencil">
              No session matches &ldquo;{filter.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-hair overflow-hidden rounded-md border border-rule bg-leaf">
              {filtered.map((session) => (
                <SessionRow key={session.sessionId} session={session} />
              ))}
            </ul>
          )}

          <StartSessionWell onStart={list.startSession} prominent={false} />
        </section>
      )}
    </div>
  );
}
