"use client";

/**
 * The teaching state for "no daemon" — shared by /sessions and /sessions/[id].
 *
 * Taste checklist item 8: the empty state IS the onboarding. It explains what the daemon
 * is (a local companion — nothing here goes through our servers), shows exactly how to
 * start it, and makes the one next action (save the token) the only prominent control.
 * Chrome stays monochrome throughout (law 1): an unreachable daemon is stated in ink on a
 * rule, never in an alarm hue.
 */
import { useState } from "react";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";

import type { DaemonConfigState } from "../_hooks/use-daemon-config";

const TOKEN_COMMAND = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
const START_COMMAND = "DAEMON_TOKEN=<your token> npm run dev -w @polytoken/daemon";

function CommandLine({ text }: { readonly text: string }): React.ReactElement {
  return (
    <pre className="overflow-x-auto rounded-md border border-hair bg-bright px-3 py-2 font-mono text-xs leading-relaxed text-ink">
      {text}
    </pre>
  );
}

export function DaemonConnectPanel({
  config,
  unreachable,
  onRetry,
}: {
  readonly config: DaemonConfigState;
  /** True when a token exists but the last connection attempt failed. */
  readonly unreachable: boolean;
  readonly onRetry: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const hasToken = config.token !== null;

  return (
    <section className="mx-auto w-full max-w-2xl p-panel">
      <div className="rounded-md border border-rule bg-leaf p-panel">
        {unreachable ? (
          <>
            <h2 className="text-base font-semibold text-ink">
              Can&apos;t reach the daemon at 127.0.0.1:{config.port}
            </h2>
            <p className="mt-2 text-sm text-faded">
              The daemon isn&apos;t answering — it may not be running, or it rejected this
              browser&apos;s token. From your machine, check it&apos;s up and the token
              below matches its <span className="font-mono text-xs">DAEMON_TOKEN</span>.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink">
              Run terminal sessions on your own machine
            </h2>
            <p className="mt-2 text-sm text-faded">
              The polytoken daemon is a small companion process that lives on your
              computer. This page connects to it directly at{" "}
              <span className="font-mono text-xs">ws://127.0.0.1:{config.port}</span> —
              your terminals never leave your machine.
            </p>
          </>
        )}

        <ol className="mt-4 space-y-3 text-sm text-faded">
          <li>
            <span className="text-ink">1. Generate a token</span> (once):
            <div className="mt-1">
              <CommandLine text={TOKEN_COMMAND} />
            </div>
          </li>
          <li>
            <span className="text-ink">2. Start the daemon</span> from your polytoken
            checkout:
            <div className="mt-1">
              <CommandLine text={START_COMMAND} />
            </div>
          </li>
          <li>
            <span className="text-ink">3. Paste the same token here:</span>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const token = draft.trim();
                if (token.length === 0) return;
                config.saveToken(token);
                setDraft("");
                onRetry();
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={hasToken ? "Token saved — paste to replace" : "Daemon token"}
                aria-label="Daemon token"
                className="font-mono text-xs"
              />
              <Button type="submit" disabled={draft.trim().length === 0}>
                {hasToken ? "Update token" : "Connect"}
              </Button>
            </form>
          </li>
        </ol>

        {unreachable && hasToken ? (
          <div className="mt-4 border-t border-hair pt-3">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry connection
            </Button>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-pencil">
          The token stays in this browser and is only ever presented to 127.0.0.1 — it is
          never sent to polytoken&apos;s servers.
        </p>
      </div>
    </section>
  );
}
