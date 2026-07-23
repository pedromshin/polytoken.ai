"use client";

/**
 * desktop-cost-ticker.tsx — the live cost readout for a running cloud desktop,
 * on the `desktop` canvas node chrome and reused by the ST-03 management pane
 * (E5 / RFC §5.3: a desktop burns money CONTINUOUSLY while it runs, so the
 * chrome must show the burn, not hide it).
 *
 * TWO PARTS, on purpose:
 *   - {@link DesktopCostTicker} is a THIN render wrapper over the pure math in
 *     `~/lib/desktop-cost`: it owns only the CLOCK (a 1s client-side interval)
 *     and re-derives the accrued total locally each tick. The arithmetic +
 *     formatting live in the pure module and are unit-tested to the cent.
 *   - {@link DesktopNodeCostTicker} is the node's self-fetching adapter: the
 *     node's `data` is REF-ONLY (an opaque sessionId, never a rate — a tampered
 *     layout row must not be able to lie about money), so the rate + start time
 *     come from the OWNER-SCOPED `desktop.list` query, fetched ONCE. The live
 *     number is that interval, NOT a poll — no server storm (INV: the control
 *     plane is the sole authority on the row; the client only animates elapsed).
 *
 * SANS chrome, monochrome (law 1/2): a cost figure is polytoken's own word, not
 * the user's evidence — no serif, no earned hue. `tabular` for the money so the
 * digits do not jitter as they tick.
 */

import * as React from "react";

import {
  accruedUsdLabel,
  elapsedRunningMs,
  formatHourlyRate,
} from "~/lib/desktop-cost";
import { api } from "~/trpc/react";

import type { DesktopNodeData } from "./panel-node-schemas";

export interface DesktopCostTickerProps {
  /** The row's declared cents-per-hour ceiling rate (desktop_sessions.hourly_rate_cents). */
  readonly hourlyRateCents: number;
  /** Epoch ms the session began accruing (the row's created_at). */
  readonly startedAtMs: number;
  /** Lifecycle state — only `running` burns compute and ticks live (RFC §5.3). */
  readonly status: DesktopNodeData["status"];
  /** Optional extra classes for the host chrome's typography. */
  readonly className?: string;
}

/**
 * DesktopCostTicker — renders the live accrued cost + the per-hour rate for a
 * running desktop, ticking once a second. For any non-running state (the
 * machine is not burning compute) it shows the declared rate as quiet reference
 * chrome and mounts NO interval.
 */
export function DesktopCostTicker({
  hourlyRateCents,
  startedAtMs,
  status,
  className,
}: DesktopCostTickerProps): React.ReactElement {
  const isRunning = status === "running";
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    if (!isRunning) return;
    // CLIENT-SIDE interval only. The rate + startedAt were fetched once; this
    // re-derives elapsed locally every second and never re-hits the server.
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const rateLabel = formatHourlyRate(hourlyRateCents);

  if (!isRunning) {
    return (
      <span className={`tabular text-2xs text-faded ${className ?? ""}`}>
        {rateLabel}
      </span>
    );
  }

  const elapsed = elapsedRunningMs(startedAtMs, nowMs);
  const accrued = accruedUsdLabel(hourlyRateCents, elapsed);

  return (
    <span
      className={`tabular text-2xs text-faded ${className ?? ""}`}
      // Not a live-region: it ticks every second and would flood a screen
      // reader; the accrued total is glanceable chrome, not an announcement.
      aria-label={`Accrued cost ${accrued}, at ${rateLabel}`}
    >
      <span className="font-medium text-ink">{accrued}</span>
      {" · "}
      {rateLabel}
    </span>
  );
}

export interface DesktopNodeCostTickerProps {
  /** The node's opaque session anchor (node.data.sessionId) — the row `id`. */
  readonly sessionId: string | undefined;
  /** The node's display status (node.data.status). */
  readonly status: DesktopNodeData["status"];
}

/**
 * DesktopNodeCostTicker — the canvas node's adapter. Resolves the session's
 * declared rate + created_at from the owner-scoped `desktop.list` query (a
 * single fetch; the live figure is {@link DesktopCostTicker}'s interval) and
 * feeds the ticker. Before the session resolves — or for a node placed before
 * its session exists — it renders an honest em-dash placeholder.
 */
export function DesktopNodeCostTicker({
  sessionId,
  status,
}: DesktopNodeCostTickerProps): React.ReactElement {
  const { data } = api.desktop.list.useQuery(undefined, {
    // One fetch: the ticker animates elapsed client-side, so there is no reason
    // to poll. A stale window keeps a canvas full of desktop nodes from each
    // re-fetching the same owned list.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const session = sessionId
    ? data?.find(
        (row) => row.id === sessionId || row.providerInstanceId === sessionId,
      )
    : undefined;

  if (!session) {
    return <span className="tabular text-2xs text-faded">burn —</span>;
  }

  return (
    <DesktopCostTicker
      hourlyRateCents={session.hourlyRateCents}
      startedAtMs={new Date(session.createdAt).getTime()}
      status={status}
    />
  );
}
